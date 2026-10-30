import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  backendDegradationLadder,
  createEngineInstaller,
  resolveArchives,
  type EngineInstallerDeps,
  type ReleaseArchive,
  type ReleaseManifest,
} from "./engine.js";
import type {
  EngineBackend,
  EnginePin,
  GpuInfo,
  HardwareProfile,
} from "@workspace/model-catalog/localModels";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
  tempRoots.length = 0;
});

describe("resolveArchives", () => {
  const manifest = releaseManifest("natlang-b1234", [
    archive("llama-natlang-bin-ubuntu-x64.tar.gz", "linux", "x64", ["cpu"]),
    archive("llama-natlang-bin-ubuntu-vulkan-x64.tar.gz", "linux", "x64", ["vulkan"]),
    archive("llama-natlang-bin-ubuntu-rocm-10.0-x64.tar.gz", "linux", "x64", ["rocm"]),
    archive("llama-natlang-bin-ubuntu-arm64.tar.gz", "linux", "arm64", ["cpu"]),
    archive("llama-natlang-bin-macos-arm64.tar.gz", "darwin", "arm64", ["metal", "cpu"]),
    archive("llama-natlang-bin-win-cpu-x64.zip", "win32", "x64", ["cpu"]),
    archive("llama-natlang-bin-win-cuda-12.4-x64.zip", "win32", "x64", ["cuda-12.4"]),
    archive("llama-natlang-cudart-win-cuda-12.4-x64.zip", "win32", "x64", ["cuda-12.4"], "cudart"),
    archive("llama-natlang-bin-win-cuda-13.4-x64.zip", "win32", "x64", ["cuda-13.4"]),
    archive("llama-natlang-cudart-win-cuda-13.4-x64.zip", "win32", "x64", ["cuda-13.4"], "cudart"),
  ]);
  const files = (hardware: Partial<HardwareProfile>, backend: EngineBackend) =>
    resolveArchives(manifest, profile(hardware), backend).map((entry) => entry.file);

  it("resolves a CUDA server archive followed by its cudart companion", () => {
    expect(files({ os: "win32" }, "cuda-12.4")).toEqual([
      "llama-natlang-bin-win-cuda-12.4-x64.zip",
      "llama-natlang-cudart-win-cuda-12.4-x64.zip",
    ]);
    expect(files({ os: "win32" }, "cuda-13.4")).toEqual([
      "llama-natlang-bin-win-cuda-13.4-x64.zip",
      "llama-natlang-cudart-win-cuda-13.4-x64.zip",
    ]);
  });

  it("selects by os, arch and backend", () => {
    expect(files({ os: "linux" }, "cpu")).toEqual(["llama-natlang-bin-ubuntu-x64.tar.gz"]);
    expect(files({ os: "linux" }, "vulkan")).toEqual(["llama-natlang-bin-ubuntu-vulkan-x64.tar.gz"]);
    expect(files({ os: "linux" }, "rocm")).toEqual(["llama-natlang-bin-ubuntu-rocm-10.0-x64.tar.gz"]);
    expect(files({ os: "linux", arch: "arm64" }, "cpu")).toEqual([
      "llama-natlang-bin-ubuntu-arm64.tar.gz",
    ]);
  });

  it("serves the CPU and Metal backends of macOS arm64 from one archive", () => {
    const hardware = { os: "darwin", arch: "arm64" } as const;
    expect(files(hardware, "metal")).toEqual(["llama-natlang-bin-macos-arm64.tar.gz"]);
    expect(files(hardware, "cpu")).toEqual(["llama-natlang-bin-macos-arm64.tar.gz"]);
  });

  it("rejects a backend the release does not publish for the platform", () => {
    expect(() => files({ os: "linux" }, "cuda-12.4")).toThrow(
      /natlang-b1234 publishes no cuda-12.4 llama.cpp archive for linux-x64/
    );
    expect(() => files({ os: "win32" }, "rocm")).toThrow(/publishes no rocm/);
  });
});

describe("backendDegradationLadder", () => {
  it("returns backend fallback order", () => {
    expect(backendDegradationLadder("cuda-12.4")).toEqual(["cuda-12.4", "vulkan", "cpu"]);
    expect(backendDegradationLadder("cuda-13.4")).toEqual(["cuda-13.4", "vulkan", "cpu"]);
    expect(backendDegradationLadder("rocm")).toEqual(["rocm", "vulkan", "cpu"]);
    expect(backendDegradationLadder("metal")).toEqual(["metal", "cpu"]);
    expect(backendDegradationLadder("vulkan")).toEqual(["vulkan", "cpu"]);
    expect(backendDegradationLadder("cpu")).toEqual(["cpu"]);
  });
});

describe("createEngineInstaller", () => {
  it("downloads, verifies, extracts, and smoke-tests CPU and GPU engines", async () => {
    const rootDir = await tempRoot();
    const hardware = profile({ os: "linux", chosenBackend: "vulkan" });
    const release = releaseFor("natlang-b1234", [
      ["llama-natlang-bin-ubuntu-x64.tar.gz", "linux", "x64", ["cpu"], "server", "cpu archive"],
      ["llama-natlang-bin-ubuntu-vulkan-x64.tar.gz", "linux", "x64", ["vulkan"], "server", "vulkan archive"],
    ]);
    const seenUrls: string[] = [];
    const { exec } = fakeExec();
    const installer = createEngineInstaller({
      rootDir,
      fetch: fakeFetch(release.files, seenUrls),
      exec,
      log: () => undefined,
    });

    const state = await installer.ensureInstalled(hardware, release.pin);

    expect(state.cpu?.backend).toBe("cpu");
    expect(state.gpu?.backend).toBe("vulkan");
    expect(state.degradedReason).toBeNull();
    expect(seenUrls).toEqual([
      "https://github.com/werg/llama.cpp-neuralese/releases/download/natlang-b1234/natlang-runtime.json",
      "https://github.com/werg/llama.cpp-neuralese/releases/download/natlang-b1234/llama-natlang-bin-ubuntu-x64.tar.gz",
      "https://github.com/werg/llama.cpp-neuralese/releases/download/natlang-b1234/llama-natlang-bin-ubuntu-vulkan-x64.tar.gz",
    ]);
    await expect(stat(state.cpu?.serverBinPath ?? "")).resolves.toMatchObject({
      mode: expect.any(Number),
    });
    await expect(stat(state.gpu?.serverBinPath ?? "")).resolves.toMatchObject({
      mode: expect.any(Number),
    });

    // Installed engines start without the network, so the manifest is not fetched again.
    const downloadCount = seenUrls.length;
    const secondState = await installer.ensureInstalled(hardware, release.pin);
    expect(secondState.cpu?.serverBinPath).toBe(state.cpu?.serverBinPath);
    expect(secondState.gpu?.serverBinPath).toBe(state.gpu?.serverBinPath);
    expect(seenUrls).toHaveLength(downloadCount);
  });

  it("rejects a manifest whose digest is not the pinned one", async () => {
    const rootDir = await tempRoot();
    const release = releaseFor("natlang-b1234", [
      ["llama-natlang-bin-ubuntu-x64.tar.gz", "linux", "x64", ["cpu"], "server", "cpu archive"],
    ]);
    const installer = createEngineInstaller({
      rootDir,
      fetch: fakeFetch(release.files, []),
      exec: fakeExec().exec,
      log: () => undefined,
    });

    await expect(
      installer.ensureInstalled(profile({ chosenBackend: "cpu" }), {
        ...release.pin,
        manifestSha256: "0".repeat(64),
      })
    ).rejects.toThrow(/Checksum mismatch for natlang-b1234 natlang-runtime.json/);
  });

  it("rejects an archive whose digest differs from the manifest", async () => {
    const rootDir = await tempRoot();
    const file = "llama-natlang-bin-ubuntu-x64.tar.gz";
    const release = releaseFor("natlang-b1234", [
      [file, "linux", "x64", ["cpu"], "server", "cpu archive"],
    ]);
    // Same length, other bytes.
    release.files.set(file, textBytes("cpu archivX"));
    const installer = createEngineInstaller({
      rootDir,
      fetch: fakeFetch(release.files, []),
      exec: fakeExec().exec,
      log: () => undefined,
    });

    await expect(
      installer.ensureInstalled(profile({ chosenBackend: "cpu" }), release.pin)
    ).rejects.toThrow(/Checksum mismatch for llama-natlang-bin-ubuntu-x64.tar.gz/);
    await expect(readdir(rootDir)).resolves.not.toContainEqual(expect.stringMatching(/^\.engine-/));
  });

  it("rejects an archive whose length differs from the manifest", async () => {
    const rootDir = await tempRoot();
    const file = "llama-natlang-bin-ubuntu-x64.tar.gz";
    const release = releaseFor("natlang-b1234", [
      [file, "linux", "x64", ["cpu"], "server", "cpu archive"],
    ]);
    release.files.set(file, textBytes("cpu archive, longer"));
    const installer = createEngineInstaller({
      rootDir,
      fetch: fakeFetch(release.files, []),
      exec: fakeExec().exec,
      log: () => undefined,
    });

    await expect(
      installer.ensureInstalled(profile({ chosenBackend: "cpu" }), release.pin)
    ).rejects.toThrow(/Size mismatch for llama-natlang-bin-ubuntu-x64.tar.gz/);
  });

  it("degrades GPU install to Vulkan after CUDA smoke-test failure", async () => {
    const rootDir = await tempRoot();
    const hardware = profile({ os: "win32", chosenBackend: "cuda-12.4" });
    const release = releaseFor("natlang-b1234", [
      ["llama-natlang-bin-win-cpu-x64.zip", "win32", "x64", ["cpu"], "server", "cpu archive"],
      ["llama-natlang-bin-win-cuda-12.4-x64.zip", "win32", "x64", ["cuda-12.4"], "server", "cuda archive"],
      ["llama-natlang-cudart-win-cuda-12.4-x64.zip", "win32", "x64", ["cuda-12.4"], "cudart", "cudart archive"],
      ["llama-natlang-bin-win-vulkan-x64.zip", "win32", "x64", ["vulkan"], "server", "vulkan archive"],
    ]);
    const seenUrls: string[] = [];
    const { exec } = fakeExec({ failSmokeBackends: new Set(["cuda-12.4"]) });
    const installer = createEngineInstaller({
      rootDir,
      fetch: fakeFetch(release.files, seenUrls),
      exec,
      log: () => undefined,
    });

    const state = await installer.ensureInstalled(hardware, release.pin);

    expect(state.cpu?.backend).toBe("cpu");
    expect(state.gpu?.backend).toBe("vulkan");
    expect(state.degradedReason).toContain("cuda-12.4");
    expect(seenUrls.map(assetFromUrl)).toEqual([
      "natlang-runtime.json",
      "llama-natlang-bin-win-cpu-x64.zip",
      "llama-natlang-bin-win-cuda-12.4-x64.zip",
      "llama-natlang-cudart-win-cuda-12.4-x64.zip",
      "llama-natlang-bin-win-vulkan-x64.zip",
    ]);
    await expect(stat(join(rootDir, "engines", "natlang-b1234", "cuda-12.4"))).rejects.toThrow();
    await expect(stat(state.gpu?.serverBinPath ?? "")).resolves.toMatchObject({
      mode: expect.any(Number),
    });
  });

  it("runs NVIDIA GPUs on Linux with the Vulkan archive, which the release has instead of CUDA", async () => {
    const rootDir = await tempRoot();
    const release = releaseFor("natlang-b1234", [
      ["llama-natlang-bin-ubuntu-x64.tar.gz", "linux", "x64", ["cpu"], "server", "cpu archive"],
      ["llama-natlang-bin-ubuntu-vulkan-x64.tar.gz", "linux", "x64", ["vulkan"], "server", "vulkan archive"],
    ]);
    const installer = createEngineInstaller({
      rootDir,
      fetch: fakeFetch(release.files, []),
      exec: fakeExec().exec,
      log: () => undefined,
    });

    const state = await installer.ensureInstalled(
      profile({ os: "linux", chosenBackend: "cuda-13.4" }),
      release.pin
    );

    expect(state.gpu?.backend).toBe("vulkan");
    expect(state.degradedReason).toMatch(/cuda-13.4.*publishes no cuda-13.4 llama.cpp archive for linux-x64/);
  });
});

function profile(overrides: Partial<HardwareProfile> = {}): HardwareProfile {
  const chosenBackend = overrides.chosenBackend ?? "cpu";
  const vendor: GpuInfo["vendor"] =
    chosenBackend === "rocm" ? "amd" : chosenBackend === "metal" ? "apple" : "nvidia";
  const chosenGpu =
    chosenBackend === "cpu"
      ? null
      : ({
          vendor,
          name: "Test GPU",
          vramMB: 12_288,
          backend: chosenBackend,
          discrete: chosenBackend !== "metal",
        } satisfies GpuInfo);

  return {
    os: "linux",
    arch: "x64",
    gpus: chosenGpu ? [chosenGpu] : [],
    cpu: { cores: 8, features: [] },
    ramMB: 32_768,
    usableRamMB: 28_672,
    chosenBackend,
    chosenGpu,
    tier: chosenBackend === "cpu" ? "cpu-strong" : "gpu-mid",
    probedAt: 1,
    notes: [],
    ...overrides,
  };
}

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "local-model-engine-"));
  tempRoots.push(root);
  return root;
}

type ArchiveSpec = [
  file: string,
  os: HardwareProfile["os"],
  arch: HardwareProfile["arch"],
  backends: EngineBackend[],
  role: ReleaseArchive["role"],
  content: string,
];

function archive(
  file: string,
  os: HardwareProfile["os"],
  arch: HardwareProfile["arch"],
  backends: EngineBackend[],
  role: ReleaseArchive["role"] = "server"
): ReleaseArchive {
  return { file, os, arch, backends, role, bytes: 1, sha256: "0".repeat(64) };
}

function releaseManifest(tag: string, archives: ReleaseArchive[]): ReleaseManifest {
  return { schema: "natlang.llama-runtime-release/2", tag, archives };
}

/** A release's files by name, including its manifest, and the pin that matches them. */
function releaseFor(
  tag: string,
  specs: ArchiveSpec[]
): { pin: EnginePin; files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  const archives = specs.map(([file, os, arch, backends, role, content]) => {
    const body = textBytes(content);
    files.set(file, body);
    return { ...archive(file, os, arch, backends, role), bytes: body.byteLength, sha256: sha256(body) };
  });
  const manifest = textBytes(JSON.stringify(releaseManifest(tag, archives)));
  files.set("natlang-runtime.json", manifest);
  return { pin: { buildTag: tag, manifestSha256: sha256(manifest) }, files };
}

function fakeFetch(files: Map<string, Uint8Array>, seenUrls: string[]): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    seenUrls.push(url);
    const asset = assetFromUrl(url);
    const body = files.get(asset);
    if (!body) {
      return new Response(`missing ${asset}`, { status: 404 });
    }
    return new Response(new Uint8Array(body));
  }) as typeof fetch;
}

function fakeExec(options: { failSmokeBackends?: Set<EngineBackend> } = {}): {
  exec: EngineInstallerDeps["exec"];
} {
  const failSmokeBackends = options.failSmokeBackends ?? new Set<EngineBackend>();
  const exec: EngineInstallerDeps["exec"] = async (bin, args) => {
    if (bin === "unzip" || bin === "tar") {
      const destinationDir = destinationFromArgs(args);
      await mkdir(join(destinationDir, "bin"), { recursive: true });
      await writeFile(join(destinationDir, "bin", "llama-server"), "#!/bin/sh\n");
      return { ok: true, stdout: "", stderr: "", code: 0 };
    }

    if (args[0] === "--version") {
      const failedBackend = [...failSmokeBackends].find(
        (backend) => bin.includes(`/${backend}.tmp/`) || bin.includes(`/${backend}/`)
      );
      if (failedBackend) {
        return { ok: false, stdout: "", stderr: `${failedBackend} failed`, code: 1 };
      }
      return { ok: true, stdout: "llama-server version test", stderr: "", code: 0 };
    }

    return { ok: false, stdout: "", stderr: `unexpected exec ${bin} ${args.join(" ")}`, code: 1 };
  };
  return { exec };
}

function destinationFromArgs(args: string[]): string {
  const flagIndex = args.findIndex((arg) => arg === "-d" || arg === "-C");
  const destination = flagIndex >= 0 ? args[flagIndex + 1] : undefined;
  if (!destination) {
    throw new Error(`missing extraction destination in ${args.join(" ")}`);
  }
  return destination;
}

function assetFromUrl(url: string): string {
  const marker = "/";
  const index = url.lastIndexOf(marker);
  if (index < 0) {
    return url;
  }
  return decodeURIComponent(url.slice(index + marker.length));
}

function textBytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
