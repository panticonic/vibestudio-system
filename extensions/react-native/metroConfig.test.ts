import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BuildProviderInput } from "@vibestudio/shared/buildProvider";
import { writeProjectedMetroConfig } from "./metroConfig.js";

const mobileClient: BuildProviderInput["client"] = {
  id: "browser",
  runtime: "react-native",
  hostAbi: "rn-host-6",
  entry: "App.tsx",
};

const temporaryRoots: string[] = [];
const require = createRequire(import.meta.url);

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("React Native provider Metro projection", () => {
  it("uses only source and dependency paths supplied by Build V2", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rn-metro-projection-"));
    temporaryRoots.push(root);
    const sourcePath = path.join(root, "source", "clients", "mobile-browser");
    const outputPath = path.join(root, "output");
    fs.mkdirSync(sourcePath, { recursive: true });
    fs.mkdirSync(outputPath, { recursive: true });
    const input: BuildProviderInput = {
      target: "react-native",
      unitName: "@workspace-clients/mobile-browser",
      sourcePath,
      dependencyProjection: {
        nodeModulesPath: path.resolve("node_modules"),
        modules: {
          "@workspace-clients/mobile-browser": sourcePath,
          "@vibestudio/mobile-iroh": path.resolve("packages/mobile-iroh"),
        },
      },
      effectiveVersion: "ev-test",
      client: mobileClient,
    };

    const configPath = writeProjectedMetroConfig(input, outputPath);
    const config = fs.readFileSync(configPath, "utf8");

    expect(config).toContain(JSON.stringify(sourcePath));
    expect(config).toContain(JSON.stringify(path.resolve("node_modules")));
    expect(config).toContain(require.resolve("@react-native/metro-config"));
    expect(config).toContain(
      JSON.stringify(path.resolve("packages/mobile-iroh")),
    );
    expect(config).toContain("react-native-keychain");
    expect(config).not.toContain("nativeModulePolicy");
    expect(config).not.toContain("process.cwd");
    expect(config).not.toContain("VIBESTUDIO_REPO_ROOT");
    expect(config).not.toContain("workspaceRoot");
    expect(config).not.toContain("clients/mobile-browser/metro.config.js");
    const loaded = require(configPath) as {
      resolver: {
        nodeModulesPaths: string[];
        extraNodeModules: Record<string, string>;
      };
    };
    expect(loaded.resolver.nodeModulesPaths).toEqual([
      path.resolve("node_modules"),
      path.resolve(
        require.resolve("@react-native/metro-config/package.json"),
        "..",
        "..",
        "..",
      ),
    ]);
    expect(loaded.resolver.extraNodeModules["@workspace-clients/mobile-browser"]).toBe(
      sourcePath,
    );
    expect(config).not.toContain("packageExportTarget");
  });

  it("injects the Babel plugins a bare app source tree cannot resolve for itself", () => {
    // A built workspace app has no node_modules beside it, so plugins named in
    // an app-authored babel.config.js would not resolve. Without these two the
    // failure is silent: Metro's first-require guard turns the module factory
    // throw into `undefined`, and the app dies on an unrelated property read.
    const sourcePath = path.resolve("clients/mobile-browser");
    const outputPath = fs.mkdtempSync(path.join(os.tmpdir(), "metro-babel-"));
    temporaryRoots.push(outputPath);
    const input: BuildProviderInput = {
      target: "react-native",
      unitName: "@workspace-clients/mobile-browser",
      sourcePath,
      dependencyProjection: {
        nodeModulesPath: path.resolve("node_modules"),
        modules: { "@workspace-clients/mobile-browser": sourcePath },
      },
      effectiveVersion: "ev-test",
      client: mobileClient,
    };

    const configPath = writeProjectedMetroConfig(input, outputPath);
    const loaded = require(configPath) as {
      transformer: { babelTransformerPath: string };
    };
    const transformerPath = loaded.transformer.babelTransformerPath;
    expect(fs.existsSync(transformerPath)).toBe(true);

    const transformerSource = fs.readFileSync(transformerPath, "utf8");
    expect(transformerSource).toContain(
      "@babel/plugin-transform-export-namespace-from",
    );
    expect(transformerSource).toContain(
      require.resolve("@react-native/metro-babel-transformer"),
    );

    // Injected plugins run after whatever Metro already asked for, and
    // Reanimated's must be last of all.
    const transformer = require(transformerPath) as {
      transform(args: { plugins?: string[] }): unknown;
    };
    const upstream = require("@react-native/metro-babel-transformer") as {
      transform: (args: unknown) => unknown;
    };
    const seen: string[][] = [];
    const original = upstream.transform;
    (upstream as { transform: unknown }).transform = (args: {
      plugins: string[];
    }) => {
      seen.push(args.plugins);
      return {};
    };
    try {
      transformer.transform({ plugins: ["existing-plugin"] });
    } finally {
      (upstream as { transform: unknown }).transform = original;
    }
    expect(seen[0]?.[0]).toBe("existing-plugin");
    expect(seen[0]?.length).toBeGreaterThan(1);
  });

  it("lets Metro resolve exact projected package subpath exports", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rn-metro-exports-"));
    temporaryRoots.push(root);
    const sourcePath = path.join(root, "clients", "mobile-browser");
    const runtimePath = path.join(root, "packages", "runtime");
    const outputPath = path.join(root, "output");
    fs.mkdirSync(sourcePath, { recursive: true });
    fs.mkdirSync(path.join(runtimePath, "src", "shared"), { recursive: true });
    fs.mkdirSync(outputPath, { recursive: true });
    fs.writeFileSync(
      path.join(runtimePath, "package.json"),
      JSON.stringify({
        name: "@workspace/runtime",
        exports: {
          "./workspace-presentation": "./src/shared/workspacePresentation.ts",
        },
      }),
    );
    fs.writeFileSync(
      path.join(runtimePath, "src", "shared", "workspacePresentation.ts"),
      "export const presentation = true;\n",
    );
    const configPath = writeProjectedMetroConfig(
      {
        target: "react-native",
        unitName: "@workspace-clients/mobile-browser",
        sourcePath,
        dependencyProjection: {
          nodeModulesPath: path.resolve("node_modules"),
          modules: { "@workspace/runtime": runtimePath },
        },
        effectiveVersion: "ev-test",
        client: mobileClient,
      },
      outputPath,
    );
    const config = require(configPath) as {
      resolver: {
        resolveRequest(
          context: {
            originModulePath: string;
            resolveRequest: (...args: unknown[]) => unknown;
          },
          moduleName: string,
          platform: string,
        ): unknown;
      };
    };
    const resolveRequest = vi.fn((_context, target) => target);

    expect(
      config.resolver.resolveRequest(
        { originModulePath: path.join(sourcePath, "App.tsx"), resolveRequest },
        "@workspace/runtime/workspace-presentation",
        "android",
      ),
    ).toBe("@workspace/runtime/workspace-presentation");
    expect(resolveRequest).toHaveBeenCalledWith(
      expect.any(Object),
      "@workspace/runtime/workspace-presentation",
      "android",
    );
  });

  it("blocks host-owned native modules from every importer", () => {
    const sourcePath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../clients/mobile-browser",
    );
    const outputPath = fs.mkdtempSync(
      path.join(os.tmpdir(), "metro-native-policy-"),
    );
    temporaryRoots.push(outputPath);
    const configPath = writeProjectedMetroConfig(
      {
        target: "react-native",
        unitName: "@workspace-clients/mobile-browser",
        sourcePath,
        dependencyProjection: {
          nodeModulesPath: path.resolve("node_modules"),
          modules: {
            "@workspace-clients/mobile-browser": sourcePath,
            "@vibestudio/mobile-iroh": path.resolve("packages/mobile-iroh"),
          },
        },
        effectiveVersion: "ev-test",
        client: mobileClient,
      },
      outputPath,
    );
    const config = require(configPath) as {
      resolver: {
        resolveRequest(
          context: {
            originModulePath: string;
            resolveRequest: (...args: unknown[]) => unknown;
          },
          moduleName: string,
          platform: string,
        ): unknown;
      };
    };
    const resolveRequest = vi.fn((_context, target) => target);
    const from = (file: string) => ({
      originModulePath: path.join(sourcePath, file),
      resolveRequest,
    });

    // The transport-free Hermes polyfills stay importable; nothing else of the
    // transport package does, from any file.
    expect(
      config.resolver.resolveRequest(
        from("src/setupGlobals.ts"),
        "@vibestudio/mobile-iroh/polyfills",
        "android",
      ),
    ).toBe("@vibestudio/mobile-iroh/polyfills");
    for (const blocked of [
      "@vibestudio/mobile-iroh",
      "@vibestudio/mobile-iroh/connectLink",
      "@vibestudio/mobile-iroh/bundleDelivery",
      "react-native-keychain",
      "@notifee/react-native",
      "@react-native-firebase/messaging",
      "@react-native-async-storage/async-storage",
      "@react-native-clipboard/clipboard",
    ]) {
      for (const importer of ["App.tsx", "src/services/workspaceDirectory.ts"]) {
        expect(() =>
          config.resolver.resolveRequest(from(importer), blocked, "android"),
        ).toThrow(
          `Import of host-owned native module "${blocked}" from client code is blocked`,
        );
      }
    }
    // A client reaches those capabilities through the host API.
    expect(
      config.resolver.resolveRequest(
        from("App.tsx"),
        "@vibestudio/rn-client-api",
        "android",
      ),
    ).toBe("@vibestudio/rn-client-api");

    // No filesystem API is installed on mobile. Preserve the actual resolver
    // failure instead of masking the unsupported import with an empty stub.
    for (const moduleName of ["fs", "node:fs"]) {
      const failure = new Error(`Native resolver cannot resolve ${moduleName}`);
      const resolveUnsupported = vi.fn(() => {
        throw failure;
      });
      try {
        config.resolver.resolveRequest(
          {
            originModulePath: path.join(sourcePath, "src/setupGlobals.ts"),
            resolveRequest: resolveUnsupported,
          },
          moduleName,
          "android",
        );
        expect.unreachable("Unsupported filesystem import must fail");
      } catch (error) {
        expect(error).toBe(failure);
      }
      expect(resolveUnsupported).toHaveBeenCalledWith(
        expect.any(Object),
        moduleName,
        "android",
      );
    }
  });
});
