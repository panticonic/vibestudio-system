import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import type { BuildProviderInput } from "@vibestudio/shared/buildProvider";

/**
 * Device-owned native modules a client bundle may not import (host ABI
 * rn-host-6). The host runtime owns the credential, the Iroh connection, push
 * and storage; a client reaches them only through `@vibestudio/rn-client-api`,
 * and the host does not register these modules in a client's React Native
 * instance at all. Blocking the import here fails the build with the reason
 * instead of failing the client at startup.
 *
 * Each entry lists the exact specifiers that stay importable (a package's
 * side-effect-free entry points); every other specifier equal to the key or
 * below it is blocked from every importer, the client's own code and its
 * dependencies alike.
 */
export const HOST_OWNED_NATIVE_IMPORTS: Readonly<Record<string, readonly string[]>> =
  Object.freeze({
    "react-native-keychain": [],
    "@react-native-firebase/app": [],
    "@react-native-firebase/messaging": [],
    "@notifee/react-native": [],
    "@react-native-async-storage/async-storage": [],
    "@react-native-clipboard/clipboard": [],
    "react-native-vision-camera": [],
    // The transport package links the Keychain and the native Iroh module. A
    // client takes only the Hermes polyfills its transport-free code needs.
    "@vibestudio/mobile-iroh": ["@vibestudio/mobile-iroh/polyfills"],
  });

export function writeProjectedMetroConfig(
  input: BuildProviderInput,
  tempDir: string,
): string {
  const nodeModulesPath = input.dependencyProjection.nodeModulesPath;
  if (!nodeModulesPath) {
    throw new Error(
      "React Native builds require a Build V2 dependency projection",
    );
  }
  // Metro is the build provider's tool, not an application runtime dependency.
  // Resolve it from this extension's exact dependency environment so a mobile
  // app does not have to duplicate the provider's implementation dependency.
  const providerRequire = createRequire(import.meta.url);
  const metroConfigPackage = providerRequire.resolve(
    "@react-native/metro-config",
  );
  const providerNodeModulesPath = path.resolve(
    path.dirname(
      providerRequire.resolve("@react-native/metro-config/package.json"),
    ),
    "..",
    "..",
  );
  const babelTransformerPath = writeBabelTransformer({
    tempDir,
    nodeModulesPath,
    providerRequire,
  });
  const configPath = path.join(tempDir, "metro.config.cjs");
  const data = JSON.stringify({
    sourcePath: input.sourcePath,
    nodeModulesPath,
    modules: input.dependencyProjection.modules,
    hostOwnedImports: HOST_OWNED_NATIVE_IMPORTS,
    metroConfigPackage,
    providerNodeModulesPath,
    babelTransformerPath,
  });
  fs.writeFileSync(configPath, metroConfigSource(data));
  return configPath;
}

function tryResolve(
  resolve: (specifier: string) => string,
  specifier: string,
): string | null {
  try {
    return resolve(specifier);
  } catch {
    return null;
  }
}

/**
 * Give Metro the Babel plugins a React Native app cannot express itself.
 *
 * Babel discovers `babel.config.js` from the project root and resolves plugin
 * names from there, but a built workspace app is a bare content-addressed
 * source tree with no `node_modules` beside it — so an app-authored config
 * could name no plugin that would actually resolve. The provider owns the
 * toolchain, so it supplies them, already resolved to absolute paths.
 *
 * Both are load-bearing rather than optional polish, and both fail in a way
 * that hides the cause: Metro's first-require guard swallows a module factory
 * throw and hands the importer `undefined`, so the visible symptom is a
 * `Cannot read property 'X' of undefined` somewhere downstream.
 *  - Reanimated's plugin compiles worklets. Without it every worklet throws
 *    the moment a library touching Reanimated is required.
 *  - `export-namespace-from` is not in @react-native/babel-preset, and any
 *    `export * as ns from "..."` silently becomes an undefined namespace.
 */
function writeBabelTransformer(input: {
  tempDir: string;
  nodeModulesPath: string;
  providerRequire: NodeJS.Require;
}): string {
  const upstream = input.providerRequire.resolve(
    "@react-native/metro-babel-transformer",
  );
  // Reanimated's plugin is versioned with the app's Reanimated, so it comes
  // from the app's dependency projection; apps without it simply get no plugin.
  const reanimated = tryResolve(
    (specifier) =>
      input.providerRequire.resolve(specifier, {
        paths: [input.nodeModulesPath],
      }),
    "react-native-reanimated/plugin",
  );
  const exportNamespace = input.providerRequire.resolve(
    "@babel/plugin-transform-export-namespace-from",
  );
  const transformerPath = path.join(input.tempDir, "babel-transformer.cjs");
  fs.writeFileSync(
    transformerPath,
    `
const upstream = require(${JSON.stringify(upstream)});
const injected = ${JSON.stringify([exportNamespace, ...(reanimated ? [reanimated] : [])])};

module.exports = {
  ...upstream,
  // Metro keys its transform cache on this. Upstream's key knows nothing about
  // the plugins injected below, so without mixing them in a bundle built before
  // this provider learned to inject them would be served from cache unchanged —
  // the untransformed output whose failure this whole shim exists to prevent.
  getCacheKey() {
    const upstreamKey = upstream.getCacheKey ? upstream.getCacheKey() : "";
    return require("node:crypto")
      .createHash("sha256")
      .update(upstreamKey)
      .update("\\u0000vibestudio-injected-babel-plugins\\u0000")
      .update(injected.join("\\u0000"))
      .digest("hex");
  },
  transform(args) {
    // Reanimated's plugin must stay last: it rewrites worklets and expects to
    // see the output of every other transform.
    return upstream.transform({ ...args, plugins: [...(args.plugins ?? []), ...injected] });
  },
};
`,
  );
  return transformerPath;
}

function metroConfigSource(data: string): string {
  return `
const fs = require("node:fs");
const path = require("node:path");
const data = ${data};
const { getDefaultConfig, mergeConfig } = require(data.metroConfigPackage);
const normalize = (value) => path.resolve(value).replace(/\\\\/g, "/");
const blockedImportFor = (moduleName) =>
  Object.keys(data.hostOwnedImports).find(
    (blocked) => moduleName === blocked || moduleName.startsWith(blocked + "/"),
  );
const guardNativeImport = (moduleName, originModulePath) => {
  const blocked = blockedImportFor(moduleName);
  if (!blocked || data.hostOwnedImports[blocked].includes(moduleName)) return;
  throw new Error(
    'Import of host-owned native module "' + moduleName + '" from client code is blocked. ' +
      'Importer: ' + (originModulePath ? normalize(originModulePath) : "unknown") + '. ' +
      'The host runtime owns this device capability; use @vibestudio/rn-client-api.',
  );
};
const polyfills = {
  path: require.resolve("path-browserify", { paths: [data.nodeModulesPath] }),
  crypto: path.join(data.sourcePath, "src/polyfills/crypto.js"),
  "node:crypto": path.join(data.sourcePath, "src/polyfills/crypto.js"),
  "node:path": require.resolve("path-browserify", { paths: [data.nodeModulesPath] }),
};
const config = {
  transformer: {
    babelTransformerPath: data.babelTransformerPath,
  },
  watchFolders: [...new Set([
    data.sourcePath,
    data.nodeModulesPath,
    data.providerNodeModulesPath,
    ...Object.values(data.modules),
  ])].filter((candidate) => fs.existsSync(candidate)),
  resolver: {
    // Application dependencies remain authoritative. Metro's own dependency
    // closure is a fallback only for build-tool runtime modules.
    nodeModulesPaths: [data.nodeModulesPath, data.providerNodeModulesPath],
    extraNodeModules: data.modules,
    resolveRequest(context, moduleName, platform) {
      guardNativeImport(moduleName, context.originModulePath);
      if (polyfills[moduleName]) return { type: "sourceFile", filePath: polyfills[moduleName] };
      if (
        moduleName === "react" ||
        moduleName === "react/jsx-runtime" ||
        moduleName === "react/jsx-dev-runtime"
      ) {
        return context.resolveRequest(
          context,
          path.join(data.nodeModulesPath, ...moduleName.split("/")),
          platform,
        );
      }
      if (moduleName === "react-native-screens") {
        return {
          type: "sourceFile",
          filePath: path.join(
            data.nodeModulesPath,
            "react-native-screens/lib/commonjs/index.js",
          ),
        };
      }
      if (
        moduleName.endsWith(".js") &&
        (moduleName.startsWith("./") || moduleName.startsWith("../") || moduleName.startsWith("/"))
      ) {
        try {
          return context.resolveRequest(context, moduleName.slice(0, -3), platform);
        } catch {}
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};
module.exports = mergeConfig(getDefaultConfig(data.sourcePath), config);
`;
}
