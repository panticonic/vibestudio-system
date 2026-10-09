import { describe, expect, it } from "vitest";
import {
  RN_HOST_ABI,
  type BuildProviderInput,
} from "@vibestudio/shared/buildProvider";
import { activate } from "./index.js";

function input(rnHostAbi: unknown): BuildProviderInput {
  return {
    target: "react-native",
    unitName: "apps/mobile",
    sourcePath: "/nonexistent",
    dependencyProjection: { nodeModulesPath: null, modules: {} },
    effectiveVersion: "ev",
    manifest: {
      app: { renderer: "index.tsx", rnComponentName: "Mobile", rnHostAbi },
    },
  };
}

describe("React Native build provider", () => {
  it("fails the build when the app declares another native host ABI", async () => {
    const provider = await activate();
    await expect(provider.build(input("rn-host-0"))).rejects.toThrow(
      `declares rnHostAbi "rn-host-0", but this host builds for "${RN_HOST_ABI}"`,
    );
  });

  it("accepts the current native host ABI", async () => {
    const provider = await activate();
    await expect(provider.build(input(RN_HOST_ABI))).rejects.toThrow(
      "React Native builds require a Build V2 dependency projection",
    );
  });
});
