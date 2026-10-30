// src/llama/node.ts
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { homedir as homedir2, platform as platform2 } from "node:os";
import { join as join2, resolve as resolve2 } from "node:path";
import { fileURLToPath } from "node:url";

// src/package/directories.ts
import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";
function defaultNatlangStateDirectory(environment = process.env) {
  if (environment.NATLANG_STATE_HOME) return resolve(environment.NATLANG_STATE_HOME);
  if (platform() === "win32") return join(environment.LOCALAPPDATA ?? homedir(), "natlang", "state");
  if (platform() === "darwin") return join(homedir(), "Library", "Application Support", "natlang", "state");
  return join(environment.XDG_STATE_HOME ?? join(homedir(), ".local", "state"), "natlang");
}
function defaultNatlangCacheDirectory(environment = process.env) {
  if (environment.NATLANG_CACHE_HOME) return resolve(environment.NATLANG_CACHE_HOME);
  if (platform() === "win32") return join(environment.LOCALAPPDATA ?? homedir(), "natlang", "cache");
  if (platform() === "darwin") return join(homedir(), "Library", "Caches", "natlang");
  return join(environment.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "natlang");
}

// src/llama/node.ts
function defaultNatlangRuntimeDirectory(environment = process.env) {
  if (environment.NATLANG_RUNTIME_HOME) return resolve2(environment.NATLANG_RUNTIME_HOME);
  if (platform2() === "win32") return join2(environment.LOCALAPPDATA ?? homedir2(), "natlang", "runtimes");
  if (platform2() === "darwin") return join2(homedir2(), "Library", "Application Support", "natlang", "runtimes");
  return join2(environment.XDG_DATA_HOME ?? join2(homedir2(), ".local", "share"), "natlang", "runtimes");
}
var nodeLlamaProcesses = {
  spawn(command, args, options) {
    const child = spawn(command, [...args], { stdio: ["ignore", "ignore", "pipe"], ...options.env ? { env: options.env } : {} });
    let failed = false;
    child.stderr?.on("data", (chunk) => options.onStderr?.(String(chunk)));
    const exited = new Promise((settle) => {
      child.once("exit", () => settle());
      child.once("error", (error) => {
        failed = true;
        options.onError?.(error);
        settle();
      });
    });
    return {
      pid: child.pid,
      exited,
      kill: (signal) => {
        child.kill(signal);
      },
      hasExited: () => failed || child.exitCode !== null || child.signalCode !== null
    };
  },
  run(command, args, options = {}) {
    const result = spawnSync(command, [...args], {
      encoding: "utf8",
      ...options.cwd ? { cwd: options.cwd } : {},
      ...options.env ? { env: options.env } : {},
      ...options.timeoutMs ? { timeout: options.timeoutMs } : {},
      ...options.output === "host" ? { stdio: ["ignore", "inherit", "inherit"] } : {}
    });
    return {
      status: result.status,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      ...result.error ? { error: result.error } : {}
    };
  },
  async freePort() {
    return await new Promise((resolvePort, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          server.close();
          reject(new Error("could not allocate a local model port"));
          return;
        }
        server.close((error) => error ? reject(error) : resolvePort(address.port));
      });
    });
  }
};
function nodeLlamaDirectories(environment = process.env) {
  const cache = defaultNatlangCacheDirectory(environment);
  return {
    runtime: defaultNatlangRuntimeDirectory(environment),
    models: resolve2(cache, "models"),
    modelHashes: resolve2(cache, "model-hashes"),
    warmPrefixes: resolve2(cache, "warm-prefixes"),
    state: defaultNatlangStateDirectory(environment),
    checkoutModels: resolve2("models"),
    // A checkout's templates (the working directory's, then the repository's) and the package's own copies.
    templates: [
      resolve2("models", "templates"),
      fileURLToPath(new URL("../../../models/templates", import.meta.url)),
      fileURLToPath(new URL("../../model-assets", import.meta.url))
    ]
  };
}
function nodeLlamaHost(environment = process.env, log = process.stderr) {
  return { environment, directories: nodeLlamaDirectories(environment), processes: nodeLlamaProcesses, fetch: (input, init) => fetch(input, init), log };
}

// src/llama/runtime.ts
import { createHash } from "node:crypto";
import {
  accessSync,
  chmodSync,
  constants,
  cpSync,
  createReadStream,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { cpus } from "node:os";
import { basename, delimiter, dirname, join as join3, relative, resolve as resolve3, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

// src/llama-runtime-release.ts
var LLAMA_RUNTIME_RELEASE = Object.freeze({
  "version": "0.8.0",
  "build": 12069,
  "commit": "a0c92ce36",
  "compatible": {
    "minimumVersion": "0.8.0",
    "maximumVersionExclusive": "0.9.0",
    "minimumBuild": 12069
  },
  "artifacts": [
    {
      "key": "darwin-arm64-metal",
      "platform": "darwin",
      "arch": "arm64",
      "backend": "metal",
      "archive": "tar.gz",
      "url": "https://github.com/werg/llama.cpp-neuralese/releases/download/natlang-b12069/llama-natlang-bin-macos-arm64.tar.gz",
      "bytes": 11190753,
      "sha256": "8b668cb2e0d7f16d1afd88fb35b25566c43782ec30a62fae33d99f1d396a45a5"
    },
    {
      "key": "darwin-x64-cpu",
      "platform": "darwin",
      "arch": "x64",
      "backend": "cpu",
      "archive": "tar.gz",
      "url": "https://github.com/werg/llama.cpp-neuralese/releases/download/natlang-b12069/llama-natlang-bin-macos-x64.tar.gz",
      "bytes": 10611984,
      "sha256": "0443c18e24ef624704ad2ea4142ac536dc266b38856f3634bf3b674b277931f2"
    },
    {
      "key": "linux-arm64-cpu",
      "platform": "linux",
      "arch": "arm64",
      "backend": "cpu",
      "archive": "tar.gz",
      "url": "https://github.com/werg/llama.cpp-neuralese/releases/download/natlang-b12069/llama-natlang-bin-ubuntu-arm64.tar.gz",
      "bytes": 14926090,
      "sha256": "eba68bf33fe131b553a4facefdd5c4e4e8c7b438644ff26340b3f9b84fe17b83"
    },
    {
      "key": "linux-x64-cpu",
      "platform": "linux",
      "arch": "x64",
      "backend": "cpu",
      "archive": "tar.gz",
      "url": "https://github.com/werg/llama.cpp-neuralese/releases/download/natlang-b12069/llama-natlang-bin-ubuntu-x64.tar.gz",
      "bytes": 18925545,
      "sha256": "a34dad20c8a434a1be249f3b027cb9f6aa275e0249cb2aad6092d587e1272c39"
    },
    {
      "key": "win32-arm64-cpu",
      "platform": "win32",
      "arch": "arm64",
      "backend": "cpu",
      "archive": "zip",
      "url": "https://github.com/werg/llama.cpp-neuralese/releases/download/natlang-b12069/llama-natlang-bin-win-cpu-arm64.zip",
      "bytes": 10893514,
      "sha256": "0011e882544eda19933432f424f57ac249759a8c7e656ca96ddc84116eab1ba1"
    },
    {
      "key": "win32-x64-cpu",
      "platform": "win32",
      "arch": "x64",
      "backend": "cpu",
      "archive": "zip",
      "url": "https://github.com/werg/llama.cpp-neuralese/releases/download/natlang-b12069/llama-natlang-bin-win-cpu-x64.zip",
      "bytes": 17925719,
      "sha256": "13099774aa5eb879bd2e9efb6ef3a220ea85fe80942b1fbdfaffa3c5fc59d574"
    }
  ]
});

// src/llama-fork-source.ts
var LLAMA_FORK_SOURCE = Object.freeze({
  repository: "werg/llama.cpp-neuralese",
  branch: "neuralese",
  commit: "a6401bbd37529eda6b94e38d8ab63a35647c5204"
});

// src/llama/runtime.ts
function semver(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(value);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}
function compare(left, right) {
  for (let index = 0; index < 3; index++) if (left[index] !== right[index]) return left[index] - right[index];
  return 0;
}
function isCompatibleLlamaVersion(version, build, release = LLAMA_RUNTIME_RELEASE) {
  const actual = semver(version), minimum = semver(release.compatible.minimumVersion), maximum = semver(release.compatible.maximumVersionExclusive);
  return Boolean(actual && minimum && maximum && compare(actual, minimum) >= 0 && compare(actual, maximum) < 0 && build >= release.compatible.minimumBuild);
}
function commandPath(command, environment) {
  if (command.includes("/") || command.includes("\\")) return existsSync(resolve3(command)) ? resolve3(command) : null;
  const extensions = process.platform === "win32" ? (environment.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";") : [""];
  for (const directory of (environment.PATH ?? "").split(delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = resolve3(directory, command + extension.toLowerCase());
      try {
        accessSync(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK);
        return candidate;
      } catch {
      }
    }
  }
  return null;
}
function inspectLlamaServer(host, path, source, release = LLAMA_RUNTIME_RELEASE) {
  const resolved = resolve3(path);
  if (!existsSync(resolved)) return {
    path: resolved,
    source,
    compatible: false,
    version: null,
    build: null,
    commit: null,
    reason: "executable does not exist",
    output: ""
  };
  const result = host.processes.run(resolved, ["--version"], { env: host.environment, timeoutMs: 1e4 });
  const output = `${result.stdout}${result.stderr}`.trim();
  if (result.error || result.status !== 0) return {
    path: resolved,
    source,
    compatible: false,
    version: null,
    build: null,
    commit: null,
    reason: result.error?.message ?? `version probe exited ${result.status}`,
    output
  };
  const match = /version:\s*(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\s*\(build\s+(\d+),\s*commit\s+([0-9a-f]+)\)/i.exec(output);
  if (!match) return {
    path: resolved,
    source,
    compatible: false,
    version: null,
    build: null,
    commit: null,
    reason: "unrecognized llama-server version output",
    output
  };
  const version = match[1], build = Number(match[2]), commit = match[3];
  const compatible = source === "fork" ? commit.length >= 7 && LLAMA_FORK_SOURCE.commit.startsWith(commit) : isCompatibleLlamaVersion(version, build, release);
  if (source === "fork") return {
    path: resolved,
    source,
    compatible,
    version,
    build,
    commit,
    reason: compatible ? null : `a build of fork commit ${commit}, not the pinned ${LLAMA_FORK_SOURCE.commit.slice(0, 9)}; run natlang runtime build`,
    output
  };
  return {
    path: resolved,
    source,
    compatible,
    version,
    build,
    commit,
    reason: compatible ? null : `needs >=${release.compatible.minimumVersion} build ${release.compatible.minimumBuild} and <${release.compatible.maximumVersionExclusive}`,
    output
  };
}
function artifactForCurrentPlatform(release) {
  return release.artifacts.find((item) => item.platform === process.platform && item.arch === process.arch) ?? null;
}
function managedRecordPath(root, release, artifact) {
  return join3(root, "llama.cpp", `b${release.build}`, artifact.key, "runtime.json");
}
function managedExecutable(root, release, artifact) {
  const record = managedRecordPath(root, release, artifact);
  if (!existsSync(record)) return null;
  try {
    const value = JSON.parse(readFileSync(record, "utf8"));
    if (!value.executable) return null;
    const base = dirname(record), path = resolve3(base, value.executable), child = relative(base, path);
    if (!child || child === ".." || child.startsWith(`..${sep}`) || resolve3(child) === child) return null;
    return existsSync(path) ? path : null;
  } catch {
    return null;
  }
}
var forkDirectory = (root) => join3(root, "llama.cpp", `fork-${LLAMA_FORK_SOURCE.commit.slice(0, 12)}-${process.platform}-${process.arch}`);
function forkExecutable(root) {
  const executable = join3(forkDirectory(root), "bin", process.platform === "win32" ? "llama-server.exe" : "llama-server");
  return existsSync(join3(forkDirectory(root), "runtime.json")) && existsSync(executable) ? executable : null;
}
async function buildForkLlamaRuntime(host, options = {}) {
  const { environment, log } = host;
  const root = host.directories.runtime, destination = forkDirectory(root);
  for (const tool of ["git", "cmake"]) if (!commandPath(tool, environment)) throw new Error(`natlang runtime build needs ${tool} on PATH`);
  const cuda = options.cuda ?? Boolean(commandPath("nvcc", environment));
  const run = (command, args, cwd) => {
    log.write(`natlang: ${command} ${args.join(" ")}
`);
    const result = host.processes.run(command, args, { cwd, env: environment, output: "host" });
    if (result.status !== 0) throw new Error(`${command} ${args[0]} failed (${result.error?.message ?? `exit ${result.status}`})`);
  };
  mkdirSync(root, { recursive: true });
  const work = mkdtempSync(join3(root, ".fork-build-"));
  try {
    const source = join3(work, "llama.cpp");
    mkdirSync(source);
    run("git", ["init", "-q"], source);
    run("git", ["fetch", "-q", "--depth", "1", `https://github.com/${LLAMA_FORK_SOURCE.repository}`, LLAMA_FORK_SOURCE.commit], source);
    run("git", ["checkout", "-q", "FETCH_HEAD"], source);
    const rpath = process.platform === "darwin" ? "@loader_path" : "$ORIGIN";
    run("cmake", [
      "-S",
      ".",
      "-B",
      "build",
      "-DCMAKE_BUILD_TYPE=Release",
      "-DLLAMA_CURL=OFF",
      "-DLLAMA_BUILD_TESTS=OFF",
      // natlang does not serve llama.cpp's web UI, which would otherwise be fetched from an unpinned "latest" bucket.
      "-DLLAMA_BUILD_EXAMPLES=OFF",
      "-DLLAMA_USE_PREBUILT_UI=OFF",
      "-DLLAMA_BUILD_UI=OFF",
      `-DCMAKE_INSTALL_RPATH=${rpath}`,
      "-DCMAKE_BUILD_WITH_INSTALL_RPATH=ON",
      ...cuda ? ["-DGGML_CUDA=ON", "-DCMAKE_CUDA_ARCHITECTURES=native"] : []
    ], source);
    run("cmake", ["--build", "build", "--config", "Release", "--target", "llama-server", "-j", String(options.jobs ?? Math.max(1, cpus().length))], source);
    const built = [join3(source, "build", "bin"), join3(source, "build", "bin", "Release")].find((path) => existsSync(join3(
      path,
      process.platform === "win32" ? "llama-server.exe" : "llama-server"
    )));
    if (!built) throw new Error("the fork build produced no llama-server");
    const staged = join3(work, "runtime");
    cpSync(built, join3(staged, "bin"), { recursive: true, verbatimSymlinks: true });
    writeFileSync(join3(staged, "runtime.json"), JSON.stringify({
      fork: true,
      repository: LLAMA_FORK_SOURCE.repository,
      commit: LLAMA_FORK_SOURCE.commit,
      backend: cuda ? "cuda" : process.platform === "darwin" ? "metal" : "cpu",
      builtAt: (/* @__PURE__ */ new Date()).toISOString()
    }, null, 2) + "\n");
    rmSync(destination, { recursive: true, force: true });
    mkdirSync(dirname(destination), { recursive: true });
    renameSync(staged, destination);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  const inspected = inspectLlamaServer(host, join3(destination, "bin", process.platform === "win32" ? "llama-server.exe" : "llama-server"), "fork");
  if (!inspected.compatible) throw new Error(`the installed fork llama-server does not run as the pinned commit: ${inspected.reason ?? inspected.output}`);
  const suffix = `-${process.platform}-${process.arch}`;
  for (const entry of readdirSync(dirname(destination)))
    if (entry.startsWith("fork-") && entry.endsWith(suffix) && join3(dirname(destination), entry) !== destination)
      rmSync(join3(dirname(destination), entry), { recursive: true, force: true });
  return inspected;
}
function discoverLlamaRuntime(host, release = LLAMA_RUNTIME_RELEASE) {
  const { environment } = host;
  const runtimeRoot = host.directories.runtime, artifact = artifactForCurrentPlatform(release);
  const candidates = [];
  if (environment.NATLANG_LLAMA_SERVER) {
    const explicit = commandPath(environment.NATLANG_LLAMA_SERVER, environment) ?? resolve3(environment.NATLANG_LLAMA_SERVER);
    const inspected = inspectLlamaServer(host, explicit, "explicit", release);
    candidates.push(inspected);
    const selected = inspected.compatible ? inspected : inspected.version ? {
      ...inspected,
      compatible: true,
      reason: `older than natlang's pinned llama.cpp ${release.version} (${inspected.reason}); used because it was chosen explicitly`
    } : null;
    return { selected, candidates, artifact, runtimeRoot };
  }
  const fork = forkExecutable(runtimeRoot);
  if (fork) candidates.push(inspectLlamaServer(host, fork, "fork", release));
  if (artifact) {
    const managed = managedExecutable(runtimeRoot, release, artifact);
    if (managed) candidates.push(inspectLlamaServer(host, managed, "managed", release));
  }
  const ambient = commandPath("llama-server", environment);
  if (ambient && !candidates.some((item) => item.path === ambient))
    candidates.push(inspectLlamaServer(host, ambient, "path", release));
  return { selected: candidates.find((item) => item.compatible) ?? null, candidates, artifact, runtimeRoot };
}
async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
function findExecutable(root) {
  const expected = process.platform === "win32" ? "llama-server.exe" : "llama-server";
  for (const name of readdirSync(root)) {
    const path = join3(root, name), status = lstatSync(path);
    if (status.isDirectory()) {
      const nested = findExecutable(path);
      if (nested) return nested;
    } else if (status.isFile() && name === expected) return path;
  }
  return null;
}
function extractArchive(host, archive, destination) {
  const result = host.processes.run("tar", ["-xf", archive, "-C", destination], { timeoutMs: 12e4 });
  if (result.status !== 0) throw new Error(`could not extract the llama.cpp archive with tar: ${(result.stderr || result.error?.message || "").trim()}`);
}
async function installManagedLlamaRuntime(host, options = {}) {
  const release = options.release ?? LLAMA_RUNTIME_RELEASE;
  const root = host.directories.runtime, artifact = artifactForCurrentPlatform(release);
  if (!artifact) throw new Error(`no managed llama.cpp runtime is published for ${process.platform}-${process.arch}; set NATLANG_LLAMA_SERVER`);
  const existing = managedExecutable(root, release, artifact);
  if (existing) {
    const inspected = inspectLlamaServer(host, existing, "managed", release);
    if (inspected.compatible) return inspected;
  }
  mkdirSync(root, { recursive: true });
  const temporary = mkdtempSync(join3(root, ".llama-install-"));
  const archive = join3(temporary, basename(new URL(artifact.url).pathname)), content = join3(temporary, "content");
  mkdirSync(content);
  host.log.write(`natlang: downloading llama.cpp ${release.version} ${artifact.key} (${Math.ceil(artifact.bytes / 1e6)} MB)
`);
  try {
    const response = await host.fetch(artifact.url, { redirect: "follow" });
    if (!response.ok || !response.body) throw new Error(`llama.cpp download failed: HTTP ${response.status}`);
    await pipeline(Readable.from(response.body), createWriteStream(archive, { flags: "wx" }));
    const status = lstatSync(archive);
    if (status.size !== artifact.bytes || await hashFile(archive) !== artifact.sha256)
      throw new Error("downloaded llama.cpp archive failed its size or SHA-256 check");
    extractArchive(host, archive, content);
    const executable = findExecutable(content);
    if (!executable) throw new Error("downloaded llama.cpp archive does not contain llama-server");
    if (process.platform !== "win32") chmodSync(executable, 493);
    const relative2 = executable.slice(content.length + 1).split("\\").join("/");
    writeFileSync(join3(content, "runtime.json"), JSON.stringify({
      version: release.version,
      build: release.build,
      commit: release.commit,
      artifact: artifact.key,
      sha256: artifact.sha256,
      executable: relative2
    }, null, 2) + "\n");
    const destination = dirname(managedRecordPath(root, release, artifact));
    mkdirSync(dirname(destination), { recursive: true });
    try {
      renameSync(content, destination);
    } catch (failure) {
      if (!existsSync(destination)) throw failure;
    }
    const installed = managedExecutable(root, release, artifact);
    if (!installed) throw new Error("managed llama.cpp runtime was not installed correctly");
    const inspected = inspectLlamaServer(host, installed, "managed", release);
    if (!inspected.compatible) throw new Error(`installed llama-server is incompatible: ${inspected.reason}`);
    return inspected;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
function describeLlamaRuntime(discovery) {
  if (discovery.selected) return `${discovery.selected.source} ${discovery.selected.path} (${discovery.selected.version}, build ${discovery.selected.build})`;
  const incompatible = discovery.candidates.map((item) => `${item.path}: ${item.reason}`).join("; ");
  return incompatible || `no llama-server found for ${process.platform}-${process.arch}`;
}

// src/model-catalog.ts
var LFM3_REPOSITORY = "LiquidAI/LFM3-1.7B-GGUF";
var LFM3_REVISION = "b3f2ae5d73cd3c91bf40e8ba752c648aa05dffdf";
var lfm3 = (quant, bytes, sha256) => Object.freeze({
  id: `lfm3-1.7b-${quant.toLowerCase()}`,
  label: `LFM3 1.7B \xB7 ${quant}`,
  family: "lfm3",
  file: `LFM3-1.7B-${quant}.gguf`,
  quant,
  bytes,
  sha256,
  // Most layers are short convolutions or 256-token windows. Measured on llama.cpp 0.8 at 163,840 tokens of Q8_0: 3,809 MiB
  // resident (12,800 bytes per token over the weights) with the default window cache, 5,380 MiB (about 23,000) with --swa-full,
  // which the server needs to reuse a cached prompt prefix at all.
  contextTokens: 32768,
  kvBytesPerToken: 23e3,
  fullSlidingWindowCache: true,
  template: "LFM3-1.7B.jinja",
  downloadUrl: `https://huggingface.co/${LFM3_REPOSITORY}/resolve/${LFM3_REVISION}/LFM3-1.7B-${quant}.gguf`,
  source: Object.freeze({ repository: LFM3_REPOSITORY, revision: LFM3_REVISION }),
  // Greedy, with reasoning kept in the history: the settings of the base evaluation.
  request: Object.freeze({ temperature: 0, chat_template_kwargs: Object.freeze({ preserve_thinking: true }) })
});
var STOCK_MODELS = Object.freeze([
  lfm3("Q4_K_M", 1099627808, "3793e1e6e2266919d6e015287221b41100175a98eddaba92e111aed3b05c93c4"),
  lfm3("Q5_K_M", 1258663200, "41e51fb0be5f472d323055f2734d986d5a2429570973508fa6322f3f07f6d7f3"),
  lfm3("Q6_K", 1427638304, "54e1bd947c77167823d45bf495f1c3e2d226ca7fb242f83cfa141ee3a6ab55c6"),
  lfm3("Q8_0", 1846238496, "8f6b24182258205e9e01e21f1f24a1f208c1e8115578825d202ce39976af20b6"),
  lfm3("BF16", 3466626336, "39158a79f56edb85e0c4252ce6447b8d7883ef82ffedd02f0cda7c84da5e9f68")
]);
var DEFAULT_LOCAL_MODEL = STOCK_MODELS.find((model) => model.quant === "Q8_0");
function stockModel(id) {
  const found = STOCK_MODELS.find((model) => model.id === id);
  if (!found) throw new Error(`unknown stock model ${id}; choose ${STOCK_MODELS.map((model) => model.id).join(", ")}`);
  return found;
}

// src/llama/models.ts
import { createReadStream as createReadStream2, createWriteStream as createWriteStream2, existsSync as existsSync2, mkdirSync as mkdirSync2, readdirSync as readdirSync2, readFileSync as readFileSync2, renameSync as renameSync2, rmSync as rmSync2, statSync, writeFileSync as writeFileSync2 } from "node:fs";
import { createHash as createHash2 } from "node:crypto";
import { basename as basename2, dirname as dirname2, join as join4, resolve as resolve4 } from "node:path";
import { Readable as Readable2 } from "node:stream";
import { pipeline as pipeline2 } from "node:stream/promises";

// src/llama/slots.ts
import { freemem } from "node:os";
var DEFAULT_KV_BYTES_PER_TOKEN = 65536;
var DEFAULT_MEMORY_FRACTION = 0.5;
var DEFAULT_MAX_SLOTS = 8;
var DEFAULT_KV_BUDGET_CAP_BYTES = 4 * 2 ** 30;
function planServerSlots(input) {
  const { local, modelBytes } = input, environment = input.environment ?? process.env;
  const contextPerSlot = local?.contextTokens ?? input.defaultContextTokens;
  const kvBytesPerToken = local?.kvBytesPerToken ?? (Number(environment.NATLANG_MODEL_KV_BYTES_PER_TOKEN) || input.defaultKvBytesPerToken || DEFAULT_KV_BYTES_PER_TOKEN);
  const envBudget = Number(environment.NATLANG_MODEL_MEMORY_BUDGET_MIB) || 0;
  const budgetMiB = local?.memoryBudgetMiB ?? (envBudget > 0 ? envBudget : void 0);
  const available = input.availableMemoryBytes ?? freemem();
  const explicit = budgetMiB !== void 0;
  const budgetBytes = explicit ? budgetMiB * 2 ** 20 : Math.min(Math.floor(available * DEFAULT_MEMORY_FRACTION), DEFAULT_KV_BUDGET_CAP_BYTES);
  if (local?.parallel !== void 0)
    return {
      budgetSource: "configured-parallel",
      slots: local.parallel,
      contextPerSlot,
      totalContext: contextPerSlot * local.parallel,
      source: "configured",
      budgetBytes: null,
      modelBytes,
      kvBytesPerToken,
      formula: "local.parallel"
    };
  const fit = Math.floor((budgetBytes - (explicit ? modelBytes : 0)) / (contextPerSlot * kvBytesPerToken));
  const slots = Math.max(1, Math.min(DEFAULT_MAX_SLOTS, Number.isFinite(fit) ? fit : 1));
  return {
    budgetSource: !explicit ? "default" : local?.memoryBudgetMiB !== void 0 ? "memoryBudgetMiB" : "NATLANG_MODEL_MEMORY_BUDGET_MIB",
    slots,
    contextPerSlot,
    totalContext: contextPerSlot * slots,
    source: "memory",
    budgetBytes,
    modelBytes,
    kvBytesPerToken,
    formula: `clamp(floor((${budgetBytes} - ${explicit ? modelBytes : 0}) / (${contextPerSlot} * ${kvBytesPerToken})), 1, ${DEFAULT_MAX_SLOTS}) = ${slots}`
  };
}

// src/llama/models.ts
function stockModelPath(host, release) {
  return join4(host.directories.models, `${release.sha256.slice(0, 12)}-${release.file}`);
}
function checkoutModelPath(host, release) {
  return host.directories.checkoutModels ? resolve4(host.directories.checkoutModels, release.file) : null;
}
function localModelPrerequisites(host, release = DEFAULT_LOCAL_MODEL) {
  const { environment } = host;
  const runtime = discoverLlamaRuntime(host), found = runtime.selected?.path ?? null;
  const explicitModel = environment.NATLANG_MODEL_PATH ? resolve4(environment.NATLANG_MODEL_PATH) : null;
  const checkoutModel = checkoutModelPath(host, release);
  const modelPath = (explicitModel ? [explicitModel] : [checkoutModel, stockModelPath(host, release)]).find((value) => Boolean(value && existsSync2(value))) ?? null;
  const template = templateCandidates(host, release).find(existsSync2) ?? null;
  const modelAvailable = Boolean(modelPath || !explicitModel && release.downloadUrl);
  const templateAvailable = Boolean(template || explicitModel && !environment.NATLANG_TEMPLATE);
  return {
    executable: found,
    available: Boolean(found && modelAvailable && templateAvailable),
    command: environment.NATLANG_LLAMA_SERVER ?? "llama-server",
    runtime,
    model: explicitModel ? basename2(explicitModel) : release.id,
    modelPath,
    template,
    downloadable: !explicitModel && Boolean(release.downloadUrl),
    downloadBytes: explicitModel ? null : release.bytes
  };
}
function localSlotPlan(host, local, modelPath = localModelPrerequisites(host).modelPath, release = DEFAULT_LOCAL_MODEL) {
  const modelBytes = modelPath && existsSync2(modelPath) ? statSync(modelPath).size : release.bytes;
  const stock = !host.environment.NATLANG_MODEL_PATH;
  return planServerSlots({
    local,
    modelBytes,
    defaultContextTokens: release.contextTokens,
    environment: host.environment,
    ...stock ? { defaultKvBytesPerToken: release.kvBytesPerToken } : {}
  });
}
async function fileHash(path) {
  const hash = createHash2("sha256");
  for await (const chunk of createReadStream2(path)) hash.update(chunk);
  return hash.digest("hex");
}
async function managedModelSha256(host, release = DEFAULT_LOCAL_MODEL) {
  const { environment } = host;
  if (!environment.NATLANG_MODEL_PATH) return release.sha256;
  const path = resolve4(environment.NATLANG_MODEL_PATH), stat = statSync(path);
  const cache = join4(host.directories.modelHashes, createHash2("sha256").update(path).digest("hex").slice(0, 24));
  const stamp = `${stat.size}:${stat.mtimeMs}`;
  try {
    const [seen, hash2] = readFileSync2(cache, "utf8").split("\n");
    if (seen === stamp && hash2 && /^[0-9a-f]{64}$/.test(hash2)) return hash2;
  } catch {
  }
  const hash = await fileHash(path);
  mkdirSync2(dirname2(cache), { recursive: true });
  writeFileSync2(cache, `${stamp}
${hash}`);
  return hash;
}
async function verifiedRelease(path, release) {
  if (!existsSync2(path)) return false;
  const stat = statSync(path), stamp = `${path}.verified`, expected = `${stat.size}:${stat.mtimeMs}:${release.sha256}`;
  if (stat.size !== release.bytes) return false;
  try {
    if (readFileSync2(stamp, "utf8") === expected) return true;
  } catch {
  }
  if (await fileHash(path) !== release.sha256) return false;
  try {
    writeFileSync2(stamp, expected);
  } catch {
  }
  return true;
}
function stockModelDownload(host, release) {
  const destination = stockModelPath(host, release), prefix = `${basename2(destination)}.partial-`;
  let names;
  try {
    names = readdirSync2(dirname2(destination));
  } catch {
    return null;
  }
  for (const name of names) {
    const pid = name.startsWith(prefix) ? Number(name.slice(prefix.length)) : NaN;
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code !== "EPERM") continue;
    }
    try {
      return { received: statSync(join4(dirname2(destination), name)).size, total: release.bytes, pid };
    } catch {
      continue;
    }
  }
  return null;
}
async function ensureStockModel(host, release, onProgress) {
  const { log } = host;
  const checkout = checkoutModelPath(host, release);
  if (checkout && await verifiedRelease(checkout, release)) return checkout;
  const destination = stockModelPath(host, release);
  if (await verifiedRelease(destination, release)) return destination;
  for (let other = stockModelDownload(host, release), announced = false; other; other = stockModelDownload(host, release)) {
    if (!announced) log.write(`natlang: waiting for the ${release.label} download already running in process ${other.pid}
`);
    announced = true;
    onProgress?.(other.received, other.total);
    await new Promise((wake) => setTimeout(wake, 1e3));
  }
  if (await verifiedRelease(destination, release)) return destination;
  mkdirSync2(dirname2(destination), { recursive: true });
  const temporary = `${destination}.partial-${process.pid}`;
  log.write(`natlang: downloading ${release.label} from ${release.source.repository} (${Math.ceil(release.bytes / 1e6)} MB, once)
`);
  try {
    const response = await host.fetch(release.downloadUrl, { redirect: "follow" });
    if (!response.ok || !response.body) throw new Error(`model download failed: HTTP ${response.status}`);
    let received = 0, reported = 0;
    const counted = async function* (body) {
      for await (const chunk of body) {
        received += chunk.length;
        onProgress?.(received, release.bytes);
        const terminal = log.isTTY === true;
        if (!onProgress && received - reported > (terminal ? 16e6 : release.bytes / 20)) {
          reported = received;
          const line = `natlang: downloaded ${Math.round(received / 1e6)} of ${Math.ceil(release.bytes / 1e6)} MB (${Math.floor(100 * received / release.bytes)}%)`;
          log.write(terminal ? `\r\x1B[2K${line}` : `${line}
`);
        }
        yield chunk;
      }
    };
    await pipeline2(Readable2.from(counted(response.body)), createWriteStream2(temporary, { flags: "wx" }));
    if (reported && log.isTTY === true) log.write("\r\x1B[2K");
    if (!await verifiedRelease(temporary, release)) throw new Error(`downloaded ${release.file} failed its size or SHA-256 check`);
    try {
      renameSync2(temporary, destination);
      renameSync2(`${temporary}.verified`, `${destination}.verified`);
    } catch (failure) {
      if (!await verifiedRelease(destination, release)) throw failure;
    }
    return destination;
  } finally {
    rmSync2(temporary, { force: true });
    rmSync2(`${temporary}.verified`, { force: true });
  }
}
async function ensureModel(host, release) {
  const { environment } = host;
  if (environment.NATLANG_MODEL_PATH) {
    const path = resolve4(environment.NATLANG_MODEL_PATH);
    if (!existsSync2(path)) throw new Error(`NATLANG_MODEL_PATH does not exist: ${path}`);
    return path;
  }
  return ensureStockModel(host, release);
}
function templateCandidates(host, release) {
  const { environment } = host;
  if (environment.NATLANG_TEMPLATE) return [resolve4(environment.NATLANG_TEMPLATE)];
  if (environment.NATLANG_MODEL_PATH) return [];
  return host.directories.templates.map((directory) => resolve4(directory, release.template));
}
function templatePath(host, release) {
  const candidates = templateCandidates(host, release);
  if (!candidates.length) return null;
  const selected = candidates.find(existsSync2);
  if (!selected) throw new Error(`missing the chat template ${candidates[0]} for ${host.environment.NATLANG_TEMPLATE ? "NATLANG_TEMPLATE" : release.id}`);
  return selected;
}
var runtimeLabel = (runtime) => runtime ? `b${runtime.build ?? "x"}${runtime.commit ? `g${runtime.commit.slice(0, 7)}` : ""}` : "bx";
var warmTag = (modelSha256, runtime, plan) => `${modelSha256.slice(0, 12)}-${runtime}-p${plan.slots}x${plan.contextPerSlot}`;

// src/llama/warm.ts
import { createHash as createHash3 } from "node:crypto";
import { existsSync as existsSync3, readdirSync as readdirSync3, readFileSync as readFileSync3, rmSync as rmSync3, statSync as statSync2, utimesSync, writeFileSync as writeFileSync3 } from "node:fs";
import { join as join5 } from "node:path";
function openingOf(request) {
  const system = request.messages[0];
  if (system?.role !== "system" || typeof system.content !== "string" || system.content.length < 256) return void 0;
  const tools = [...request.tools ?? []];
  return {
    system: { role: "system", content: system.content },
    tools,
    key: createHash3("sha256").update(JSON.stringify([system.content, tools])).digest("hex")
  };
}
function sharedPrefix(first, second) {
  let length = 0;
  while (length < first.length && length < second.length && first[length] === second[length]) length++;
  const common = first.slice(0, length);
  let cut = 0;
  for (const match of common.matchAll(/<\|[^|<>\s]{1,40}\|>|<\/?[a-z_]{2,24}>/g)) cut = match.index + match[0].length;
  return common.slice(0, cut);
}
async function post(host, endpoint, headers, path, body) {
  const response = await host.fetch(endpoint + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}
async function warmOpening(host, server, directory, opening, tag, slots) {
  const { endpoint, headers } = server;
  const file = `${opening.key.slice(0, 16)}-${tag}.slot`, path = join5(directory, file), meta = `${path}.json`;
  let created = false, info;
  try {
    if (existsSync3(path)) info = JSON.parse(readFileSync3(meta, "utf8"));
  } catch {
    info = void 0;
  }
  let first = 0;
  if (!info) {
    const render = async (content) => String((await post(
      host,
      endpoint,
      headers,
      "/apply-template",
      { messages: [opening.system, { role: "user", content }], ...opening.tools.length ? { tools: opening.tools } : {} }
    )).prompt ?? "");
    const prefix = sharedPrefix(await render("\u2063A"), await render("\u2063B"));
    if (prefix.length < 256) return void 0;
    await post(host, endpoint, headers, "/slots/0?action=erase", {}).catch(() => void 0);
    const completion = await post(host, endpoint, headers, "/completion", { prompt: prefix, n_predict: 0, cache_prompt: true, id_slot: 0 });
    info = { chars: prefix.length, tokens: Number(completion.timings?.prompt_n ?? completion.tokens_evaluated ?? 0) };
    await post(host, endpoint, headers, "/slots/0?action=save", { filename: file });
    writeFileSync3(meta, JSON.stringify(info));
    created = true;
    first = 1;
  } else {
    const now = /* @__PURE__ */ new Date();
    try {
      utimesSync(path, now, now);
    } catch {
    }
  }
  let restored = first;
  for (let slot = first; slot < slots; slot++) {
    try {
      await post(host, endpoint, headers, `/slots/${slot}?action=restore`, { filename: file });
      restored++;
    } catch {
      break;
    }
  }
  return { sha256: opening.key, chars: info.chars, tokens: info.tokens, bytes: statSync2(path).size, file, restoredSlots: restored, created };
}
function pruneWarmStates(directory, keep = 24) {
  if (!existsSync3(directory)) return;
  const states = readdirSync3(directory).filter((name) => name.endsWith(".slot")).map((name) => ({ name, at: statSync2(join5(directory, name)).mtimeMs })).sort((a, b) => b.at - a.at);
  for (const state of states.slice(keep)) {
    rmSync3(join5(directory, state.name), { force: true });
    rmSync3(join5(directory, `${state.name}.json`), { force: true });
  }
}

// src/llama/shared.ts
import { existsSync as existsSync4, mkdirSync as mkdirSync3, readFileSync as readFileSync4, renameSync as renameSync3, rmSync as rmSync4, writeFileSync as writeFileSync4 } from "node:fs";
import { dirname as dirname3, join as join6 } from "node:path";
var sharedServerPath = (host) => join6(host.directories.state, "model-server.json");
function publishSharedServer(host, server) {
  const path = sharedServerPath(host), temporary = `${path}.${process.pid}.tmp`;
  mkdirSync3(dirname3(path), { recursive: true });
  writeFileSync4(temporary, JSON.stringify({ schema: "natlang.shared-model-server/1", ...server }, null, 2) + "\n");
  renameSync3(temporary, path);
}
function withdrawSharedServer(host, pid) {
  const current = readSharedServer(host);
  if (current?.pid === pid) rmSync4(sharedServerPath(host), { force: true });
}
function readSharedServer(host) {
  const path = sharedServerPath(host);
  if (!existsSync4(path)) return void 0;
  try {
    const value = JSON.parse(readFileSync4(path, "utf8"));
    return value.schema === "natlang.shared-model-server/1" ? value : void 0;
  } catch {
    return void 0;
  }
}
var alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};
async function findSharedServer(host, modelSha256, runtime) {
  if (host.environment.NATLANG_SHARED_SERVER === "off") return void 0;
  const server = readSharedServer(host);
  if (!server || server.pid === process.pid || server.modelSha256 !== modelSha256 || server.runtime !== runtime || !alive(server.pid)) return void 0;
  try {
    const response = await host.fetch(server.endpoint + "/health", { signal: AbortSignal.timeout(2e3) });
    return response.ok ? server : void 0;
  } catch {
    return void 0;
  }
}

// src/llama/server.ts
import { basename as basename3 } from "node:path";
import { mkdirSync as mkdirSync4 } from "node:fs";
var serverHelp = /* @__PURE__ */ new Map();
function serverSupports(host, executable, option) {
  let help = serverHelp.get(executable);
  if (help === void 0) {
    const result = host.processes.run(executable, ["--help"], { timeoutMs: 2e4 });
    serverHelp.set(executable, help = `${result.stdout}${result.stderr}`);
  }
  return help.includes(option);
}
var supportsPerSequenceLora = (host, executable) => serverSupports(host, executable, "--lora-per-sequence");
var supportsNativeStates = (host, executable) => serverSupports(host, executable, "--native-state");
async function stopProcess(child) {
  if (child.hasExited()) return;
  child.kill("SIGTERM");
  let timer;
  await Promise.race([child.exited, new Promise((resolveTimeout) => {
    timer = setTimeout(resolveTimeout, 5e3);
  })]);
  if (timer) clearTimeout(timer);
  if (!child.hasExited()) child.kill("SIGKILL");
}
async function serverIdle(host, endpoint, headers) {
  try {
    const response = await host.fetch(endpoint + "/slots", { signal: AbortSignal.timeout(2e3), ...headers ? { headers } : {} });
    const slots = await response.json();
    return response.ok && Array.isArray(slots) && slots.every((slot) => !slot.is_processing);
  } catch {
    return false;
  }
}
function spawnLauncher(host) {
  return async (launch, signal) => {
    let recentError = "";
    const child = host.processes.spawn(launch.command, launch.args, {
      onStderr: (text) => {
        recentError = (recentError + text).slice(-16e3);
      },
      onError: (failure) => {
        recentError = `${recentError}
${failure.message}`.slice(-16e3);
      }
    });
    const terminate = (signalName) => {
      child.kill("SIGTERM");
      child.kill("SIGINT");
      process.removeListener(signalName, terminate);
      if (!process.listenerCount(signalName)) process.kill(process.pid, signalName);
    };
    const onExit = () => {
      if (!child.hasExited()) child.kill("SIGTERM");
    };
    process.prependOnceListener("SIGINT", terminate);
    process.prependOnceListener("SIGTERM", terminate);
    process.once("exit", onExit);
    const stop = async () => {
      process.removeListener("SIGINT", terminate);
      process.removeListener("SIGTERM", terminate);
      process.removeListener("exit", onExit);
      await stopProcess(child);
    };
    try {
      const deadline = Date.now() + Number(host.environment.NATLANG_MODEL_START_TIMEOUT_MS ?? 12e4);
      while (Date.now() < deadline) {
        signal.throwIfAborted();
        if (child.hasExited()) throw new Error(`managed model server exited during startup
${recentError.trim()}`);
        try {
          const response = await host.fetch(launch.endpoint + "/health");
          if (response.ok) return { stop };
        } catch {
        }
        await new Promise((resolveWait) => setTimeout(resolveWait, 250));
      }
      throw new Error(`managed model server did not become ready within the startup timeout
${recentError.trim()}`);
    } catch (failure) {
      await stop();
      throw failure;
    }
  };
}
function createLlamaServer(host, options = {}) {
  const { environment, log } = host;
  const release = options.release ?? DEFAULT_LOCAL_MODEL, headers = options.headers;
  let prerequisites = localModelPrerequisites(host, release);
  let launched = null, endpoint = null, starting = null;
  const stopping = new AbortController();
  let closed = false, plan = null;
  const loraIndex = /* @__PURE__ */ new Map(), nativeStatesLoaded = /* @__PURE__ */ new Set();
  let warming = false, inflight = 0, contended = false, sharedServer = false, modelSha256 = null, runtime = null;
  const openings = /* @__PURE__ */ new Map(), warmed = [];
  const warmFor = async (request) => {
    const opening = openingOf(request);
    if (!opening) return;
    let pending = openings.get(opening.key);
    if (!pending) {
      if (inflight > 0) return;
      pending = (async () => {
        const base = await start();
        if (!warming) return void 0;
        if (contended && !await serverIdle(host, base, headers)) {
          openings.delete(opening.key);
          return void 0;
        }
        const sha = modelSha256 ?? await managedModelSha256(host, release);
        const state = await warmOpening(
          host,
          { endpoint: base, ...headers ? { headers } : {} },
          host.directories.warmPrefixes,
          opening,
          warmTag(sha, runtime ?? runtimeLabel(prerequisites.runtime.selected), plan),
          plan?.slots ?? 1
        );
        if (state) {
          warmed.push(state);
          log.write(state.created ? `natlang: prefilled the ${state.tokens}-token prompt opening once for this model; later calls and runs restore it
` : `natlang: restored the warm ${state.tokens}-token prompt opening into ${state.restoredSlots} slot${state.restoredSlots === 1 ? "" : "s"}
`);
          pruneWarmStates(host.directories.warmPrefixes);
        }
        return state;
      })().catch((failure) => {
        log.write(`natlang: prompt warming skipped: ${failure.message.split("\n")[0].slice(0, 200)}
`);
        return void 0;
      });
      openings.set(opening.key, pending);
    }
    await pending;
  };
  const startServer = async () => {
    const { attach } = options;
    if (attach) {
      plan = {
        budgetSource: "configured-parallel",
        slots: attach.slots,
        contextPerSlot: attach.contextPerSlot,
        totalContext: attach.slots * attach.contextPerSlot,
        source: "configured",
        budgetBytes: null,
        modelBytes: 0,
        kvBytesPerToken: 0,
        formula: "server supervised by the host"
      };
      warming = environment.NATLANG_WARM_PREFIXES !== "off" && attach.warm === true;
      contended = true;
      modelSha256 = attach.modelSha256;
      runtime = attach.runtime;
      return attach.endpoint;
    }
    if (!prerequisites.executable && options.ensureRuntime) {
      const installed = await options.ensureRuntime(prerequisites.runtime);
      if (installed?.compatible) prerequisites = { ...localModelPrerequisites(host, release), executable: installed.path };
    }
    if (!prerequisites.executable) {
      const explicit = prerequisites.runtime.candidates.find((candidate) => candidate.source === "explicit");
      if (explicit) throw new Error(`NATLANG_LLAMA_SERVER is incompatible: ${describeLlamaRuntime(prerequisites.runtime)}`);
      throw new Error(`managed model server is unavailable: ${describeLlamaRuntime(prerequisites.runtime)}; run natlang --setup or natlang --runtime install`);
    }
    const adapterless = !(options.loraAdapters?.() ?? []).length && !(options.nativeStates?.() ?? []).length;
    const shared = adapterless && options.useSharedServer !== false ? await findSharedServer(host, await managedModelSha256(host, release), runtimeLabel(prerequisites.runtime.selected)) : void 0;
    if (shared) {
      plan = {
        budgetSource: "configured-parallel",
        slots: shared.slots,
        contextPerSlot: shared.contextPerSlot,
        totalContext: shared.slots * shared.contextPerSlot,
        source: "configured",
        budgetBytes: null,
        modelBytes: 0,
        kvBytesPerToken: 0,
        formula: `shared model server (pid ${shared.pid})`
      };
      contended = true;
      sharedServer = true;
      warming = environment.NATLANG_WARM_PREFIXES !== "off" && !!shared.warm;
      log.write(`natlang: using the ${shared.model} model kept loaded at ${shared.endpoint} (${shared.slots} slots)
`);
      return shared.endpoint;
    }
    const modelPath = await ensureModel(host, release);
    if (closed) throw new Error("model session is closed");
    const port = await host.processes.freePort();
    const base = `http://127.0.0.1:${port}`;
    plan = localSlotPlan(host, options.local, modelPath, release);
    const template = templatePath(host, release);
    const args = [
      "-m",
      modelPath,
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--parallel",
      String(plan.slots),
      "-c",
      String(plan.totalContext),
      "-ngl",
      String(options.local?.gpuLayers ?? 99),
      "--cache-ram",
      String(options.local?.cacheRamMiB ?? 256),
      "--no-webui",
      "--jinja",
      ...template ? ["--chat-template-file", template] : [],
      // The stock file's sliding-window layers need the full cache for a warm opening or earlier prompt to be reused.
      ...release.fullSlidingWindowCache && !environment.NATLANG_MODEL_PATH ? ["--swa-full"] : [],
      ...options.local?.args ?? []
    ];
    loraIndex.clear();
    const adapters = options.loraAdapters?.() ?? [];
    if (adapters.length) {
      args.push("--lora-init-without-apply", ...supportsPerSequenceLora(host, prerequisites.executable) ? ["--lora-per-sequence"] : []);
      for (const adapter of adapters) {
        loraIndex.set(adapter.id, loraIndex.size);
        args.push("--lora", adapter.path);
      }
    }
    warming = environment.NATLANG_WARM_PREFIXES !== "off" && !adapters.length && !(options.nativeStates?.() ?? []).length;
    if (warming) {
      mkdirSync4(host.directories.warmPrefixes, { recursive: true });
      args.push("--slot-save-path", host.directories.warmPrefixes);
    }
    nativeStatesLoaded.clear();
    const states = options.nativeStates?.() ?? [];
    if (states.length) {
      if (!supportsNativeStates(host, prerequisites.executable))
        throw new Error(`weights-unavailable: ${prerequisites.executable} cannot import native state spans (tuned soft states need the llama.cpp fork's --native-state)`);
      for (const state of states) {
        nativeStatesLoaded.add(state.id);
        args.push("--native-state", state.path);
      }
    }
    log.write(`natlang: starting managed model ${basename3(modelPath)} with ${plan.slots} slot${plan.slots === 1 ? "" : "s"} (${plan.contextPerSlot} tokens each; ${plan.budgetSource === "configured-parallel" ? "local.parallel" : `${plan.budgetSource === "default" ? "default" : plan.budgetSource} KV budget ${Math.round((plan.budgetBytes ?? 0) / 2 ** 20)} MiB`})
`);
    stopping.signal.throwIfAborted();
    const startedAt = Date.now();
    launched = await (options.launch ?? spawnLauncher(host))({ command: prerequisites.executable, args, port, endpoint: base }, stopping.signal);
    log.write(`natlang: model ready in ${((Date.now() - startedAt) / 1e3).toFixed(1)} s
`);
    return base;
  };
  const start = async () => {
    if (closed) throw new Error("model session is closed");
    if (endpoint) return endpoint;
    if (starting) return starting;
    starting = startServer();
    try {
      return endpoint = await starting;
    } finally {
      starting = null;
    }
  };
  return {
    start,
    async admit(request, signal) {
      signal?.throwIfAborted();
      const base = await start();
      signal?.throwIfAborted();
      await warmFor(request);
      signal?.throwIfAborted();
      inflight++;
      let released = false;
      return { endpoint: base, release() {
        if (!released) {
          released = true;
          inflight--;
        }
      } };
    },
    plan: () => plan,
    loraIndex,
    nativeStatesLoaded,
    status: () => ({
      endpoint,
      executable: prerequisites.executable,
      running: Boolean(launched || sharedServer || options.attach && endpoint),
      shared: sharedServer,
      runtimeBuild: prerequisites.runtime.selected?.build ?? null,
      runtime: runtime ?? (prerequisites.runtime.selected ? runtimeLabel(prerequisites.runtime.selected) : null),
      warm: [...warmed]
    }),
    async close() {
      closed = true;
      stopping.abort();
      if (starting) await starting.catch(() => void 0);
      await launched?.stop();
      launched = null;
      endpoint = null;
    }
  };
}
export {
  DEFAULT_KV_BUDGET_CAP_BYTES,
  DEFAULT_KV_BYTES_PER_TOKEN,
  DEFAULT_LOCAL_MODEL,
  DEFAULT_MAX_SLOTS,
  DEFAULT_MEMORY_FRACTION,
  LLAMA_FORK_SOURCE,
  LLAMA_RUNTIME_RELEASE,
  STOCK_MODELS,
  buildForkLlamaRuntime,
  createLlamaServer,
  defaultNatlangRuntimeDirectory,
  describeLlamaRuntime,
  discoverLlamaRuntime,
  ensureModel,
  ensureStockModel,
  findSharedServer,
  inspectLlamaServer,
  installManagedLlamaRuntime,
  isCompatibleLlamaVersion,
  localModelPrerequisites,
  localSlotPlan,
  managedModelSha256,
  nodeLlamaDirectories,
  nodeLlamaHost,
  nodeLlamaProcesses,
  openingOf,
  planServerSlots,
  pruneWarmStates,
  publishSharedServer,
  readSharedServer,
  runtimeLabel,
  sharedPrefix,
  sharedServerPath,
  spawnLauncher,
  stockModel,
  stockModelDownload,
  stockModelPath,
  supportsNativeStates,
  templatePath,
  warmOpening,
  warmTag,
  withdrawSharedServer
};
