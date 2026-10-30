import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { chmod, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";

import type {
  EngineBackend,
  EnginePin,
  EngineState,
  HardwareProfile,
  InstalledEngine,
} from "@workspace/model-catalog/localModels";
import { ROOT_LAYOUT } from "./constants.js";

export interface EngineInstallerDeps {
  rootDir: string;
  fetch: typeof fetch;
  exec(
    bin: string,
    args: string[],
    opts?: { timeoutMs?: number; env?: Record<string, string> }
  ): Promise<{ ok: boolean; stdout: string; stderr: string; code: number | null }>;
  log(msg: string, data?: unknown): void;
}

/** The engine is natlang's llama.cpp fork. Its releases are published by the fork's `natlang-runtime` workflow, whose
 * `natlang-runtime.json` manifest describes every archive: the pin holds the release tag and the manifest's digest. */
const RELEASE_BASE_URL = "https://github.com/werg/llama.cpp-neuralese/releases/download";
const MANIFEST_FILE = "natlang-runtime.json";
const MANIFEST_SCHEMA = "natlang.llama-runtime-release/2";
const SMOKE_TIMEOUT_MS = 30_000;
const EXTRACT_TIMEOUT_MS = 120_000;

/** One archive of a release, as its manifest lists it. `role` is `cudart` for the CUDA runtime DLLs that are extracted
 * next to the `server` archive of the same backend. */
export interface ReleaseArchive {
  file: string;
  os: HardwareProfile["os"];
  arch: HardwareProfile["arch"];
  backends: EngineBackend[];
  role: "server" | "cudart";
  bytes: number;
  sha256: string;
}

export interface ReleaseManifest {
  schema: typeof MANIFEST_SCHEMA;
  tag: string;
  archives: ReleaseArchive[];
}

/** The archives to extract, in order, for `backend` on `profile`'s platform: its server archive, then its companions. */
export function resolveArchives(
  manifest: ReleaseManifest,
  profile: Pick<HardwareProfile, "os" | "arch">,
  backend: EngineBackend
): ReleaseArchive[] {
  const matching = manifest.archives.filter(
    (archive) =>
      archive.os === profile.os && archive.arch === profile.arch && archive.backends.includes(backend)
  );
  const server = matching.find((archive) => archive.role === "server");
  if (!server) {
    throw new Error(
      `Release ${manifest.tag} publishes no ${backend} llama.cpp archive for ${profile.os}-${profile.arch}`
    );
  }
  return [server, ...matching.filter((archive) => archive.role === "cudart")];
}

export function backendDegradationLadder(backend: EngineBackend): EngineBackend[] {
  switch (backend) {
    case "cuda-12.4":
    case "cuda-13.4":
      return [backend, "vulkan", "cpu"];
    case "rocm":
      return ["rocm", "vulkan", "cpu"];
    case "metal":
      return ["metal", "cpu"];
    case "vulkan":
      return ["vulkan", "cpu"];
    case "cpu":
      return ["cpu"];
  }
}

export function createEngineInstaller(deps: EngineInstallerDeps): {
  ensureInstalled(profile: HardwareProfile, pin: EnginePin): Promise<EngineState>;
} {
  async function ensureInstalled(profile: HardwareProfile, pin: EnginePin): Promise<EngineState> {
    await mkdir(join(deps.rootDir, ROOT_LAYOUT.enginesDir), { recursive: true });

    // Fetched only when an archive has to be installed, so an installed engine starts without the network.
    let manifest: Promise<ReleaseManifest> | null = null;
    const loadManifest = () => (manifest ??= fetchManifest(deps, pin));

    const cpu = await installBackend(deps, profile, pin, "cpu", loadManifest);
    let gpu: InstalledEngine | null = null;
    let degradedReason: string | null = null;

    if (profile.chosenBackend !== "cpu") {
      const attempts = backendDegradationLadder(profile.chosenBackend);

      for (const backend of attempts) {
        try {
          gpu =
            backend === "cpu"
              ? cpu
              : await installBackend(deps, profile, pin, backend, loadManifest);
          if (backend !== profile.chosenBackend && degradedReason === null) {
            degradedReason = `degraded from ${profile.chosenBackend} to ${backend}`;
          }
          break;
        } catch (error) {
          if (backend === "cpu") {
            throw error;
          }
          degradedReason = `degraded from ${profile.chosenBackend}: ${errorMessage(error)}`;
          deps.log("local-models engine GPU install failed; trying fallback backend", {
            backend,
            error: errorMessage(error),
          });
        }
      }
    }

    await pruneOldBuilds(deps.rootDir, pin.buildTag);
    return { pin, cpu, gpu, degradedReason };
  }

  return { ensureInstalled };
}

async function fetchManifest(
  deps: EngineInstallerDeps,
  pin: EnginePin
): Promise<ReleaseManifest> {
  const response = await deps.fetch(`${RELEASE_BASE_URL}/${pin.buildTag}/${MANIFEST_FILE}`);
  if (!response.ok) {
    throw new Error(`Failed to download ${pin.buildTag} ${MANIFEST_FILE}: HTTP ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const digest = sha256(bytes);
  if (digest !== pin.manifestSha256.toLowerCase()) {
    throw new Error(
      `Checksum mismatch for ${pin.buildTag} ${MANIFEST_FILE}: expected ${pin.manifestSha256}, got ${digest}`
    );
  }
  const manifest = JSON.parse(new TextDecoder().decode(bytes)) as ReleaseManifest;
  if (manifest.schema !== MANIFEST_SCHEMA || manifest.tag !== pin.buildTag) {
    throw new Error(`${MANIFEST_FILE} is not the ${MANIFEST_SCHEMA} manifest of ${pin.buildTag}`);
  }
  return manifest;
}

async function installBackend(
  deps: EngineInstallerDeps,
  profile: HardwareProfile,
  pin: EnginePin,
  backend: EngineBackend,
  loadManifest: () => Promise<ReleaseManifest>
): Promise<InstalledEngine> {
  const targetDir = engineDir(deps.rootDir, pin.buildTag, backend);
  const existing = await smokeExistingInstall(deps, targetDir, pin.buildTag, backend);
  if (existing) {
    return existing;
  }

  const archives = resolveArchives(await loadManifest(), profile, backend);
  const tmpDir = `${targetDir}.tmp`;
  await rm(tmpDir, { recursive: true, force: true });
  await mkdir(tmpDir, { recursive: true });

  try {
    for (const archive of archives) {
      const archivePath = await downloadArchive(deps, pin, archive);
      try {
        await extractArchive(deps, archivePath, tmpDir);
      } finally {
        await rm(archivePath, { force: true });
      }
    }

    const serverBinPath = await findLlamaServer(tmpDir);
    await chmod(serverBinPath, 0o755);
    await smokeTest(deps, serverBinPath);
    await rm(targetDir, { recursive: true, force: true });
    await mkdir(dirname(targetDir), { recursive: true });
    await rename(tmpDir, targetDir);

    const installedServerBinPath = join(targetDir, relativePath(tmpDir, serverBinPath));
    return {
      buildTag: pin.buildTag,
      backend,
      dir: targetDir,
      serverBinPath: installedServerBinPath,
      smokeTestedAt: Date.now(),
    };
  } catch (error) {
    await rm(tmpDir, { recursive: true, force: true });
    throw error;
  }
}

async function smokeExistingInstall(
  deps: EngineInstallerDeps,
  dir: string,
  buildTag: string,
  backend: EngineBackend
): Promise<InstalledEngine | null> {
  try {
    const serverBinPath = await findLlamaServer(dir);
    await chmod(serverBinPath, 0o755);
    await smokeTest(deps, serverBinPath);
    return {
      buildTag,
      backend,
      dir,
      serverBinPath,
      smokeTestedAt: Date.now(),
    };
  } catch {
    return null;
  }
}

/** Streams the archive to disk and accepts it only if its byte length and SHA-256 are the manifest's. */
async function downloadArchive(
  deps: EngineInstallerDeps,
  pin: EnginePin,
  archive: ReleaseArchive
): Promise<string> {
  const response = await deps.fetch(`${RELEASE_BASE_URL}/${pin.buildTag}/${archive.file}`);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${archive.file}: HTTP ${response.status}`);
  }

  const archivePath = join(
    deps.rootDir,
    `.engine-${process.pid}-${Date.now()}-${safeFileName(archive.file)}`
  );
  const hash = createHash("sha256");
  let length = 0;
  try {
    await pipeline(
      Readable.fromWeb(response.body as WebReadableStream<Uint8Array>),
      async function* (chunks: AsyncIterable<Uint8Array>) {
        for await (const chunk of chunks) {
          hash.update(chunk);
          length += chunk.byteLength;
          yield chunk;
        }
      },
      createWriteStream(archivePath, { flags: "wx" })
    );
    const digest = hash.digest("hex");
    if (length !== archive.bytes) {
      throw new Error(
        `Size mismatch for ${archive.file}: expected ${archive.bytes} bytes, got ${length}`
      );
    }
    if (digest !== archive.sha256.toLowerCase()) {
      throw new Error(
        `Checksum mismatch for ${archive.file}: expected ${archive.sha256}, got ${digest}`
      );
    }
    return archivePath;
  } catch (error) {
    await rm(archivePath, { force: true });
    throw error;
  }
}

async function extractArchive(
  deps: EngineInstallerDeps,
  archivePath: string,
  destinationDir: string
): Promise<void> {
  const fileName = basename(archivePath);
  const result = fileName.endsWith(".zip")
    ? await deps.exec("unzip", ["-q", archivePath, "-d", destinationDir], {
        timeoutMs: EXTRACT_TIMEOUT_MS,
      })
    : await deps.exec("tar", ["xzf", archivePath, "-C", destinationDir], {
        timeoutMs: EXTRACT_TIMEOUT_MS,
      });

  if (!result.ok) {
    throw new Error(`Failed to extract ${fileName}: ${execFailureSummary(result)}`);
  }
}

async function smokeTest(deps: EngineInstallerDeps, serverBinPath: string): Promise<void> {
  const result = await deps.exec(serverBinPath, ["--version"], { timeoutMs: SMOKE_TIMEOUT_MS });
  if (!result.ok) {
    throw new Error(`llama-server smoke test failed: ${execFailureSummary(result)}`);
  }
}

async function findLlamaServer(root: string): Promise<string> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      try {
        return await findLlamaServer(fullPath);
      } catch (error) {
        if (!isNotFound(error)) {
          throw error;
        }
      }
    } else if (
      entry.isFile() &&
      (entry.name === "llama-server" || entry.name === "llama-server.exe")
    ) {
      return fullPath;
    }
  }
  throw notFoundError(`Could not locate llama-server under ${root}`);
}

async function pruneOldBuilds(rootDir: string, currentBuildTag: string): Promise<void> {
  const enginesDir = join(rootDir, ROOT_LAYOUT.enginesDir);
  const entries = await readdir(enginesDir, { withFileTypes: true });
  const buildDirs = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && !entry.name.endsWith(".tmp"))
      .map(async (entry) => ({
        name: entry.name,
        path: join(enginesDir, entry.name),
        mtimeMs: (await stat(join(enginesDir, entry.name))).mtimeMs,
      }))
  );
  const previous = buildDirs
    .filter((entry) => entry.name !== currentBuildTag)
    .sort((left, right) => right.mtimeMs - left.mtimeMs || right.name.localeCompare(left.name))[0];
  const keep = new Set(
    [currentBuildTag, previous?.name].filter((value): value is string => Boolean(value))
  );

  await Promise.all(
    buildDirs
      .filter((entry) => !keep.has(entry.name))
      .map((entry) => rm(entry.path, { recursive: true, force: true }))
  );
}

function engineDir(rootDir: string, buildTag: string, backend: EngineBackend): string {
  return join(rootDir, ROOT_LAYOUT.enginesDir, buildTag, backend);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function relativePath(parent: string, child: string): string {
  const prefix = parent.endsWith("/") ? parent : `${parent}/`;
  if (!child.startsWith(prefix)) {
    throw new Error(`${child} is not under ${parent}`);
  }
  return child.slice(prefix.length);
}

function safeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function execFailureSummary(result: {
  stdout: string;
  stderr: string;
  code: number | null;
}): string {
  return result.stderr || result.stdout || String(result.code ?? "unknown error");
}

function notFoundError(message: string): Error {
  const error = new Error(message);
  error.name = "NotFoundError";
  return error;
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && error.name === "NotFoundError";
}
