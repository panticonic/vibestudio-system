import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import type { BuildProviderInput } from "@vibestudio/shared/buildProvider";
import { activate, integrityForFile } from "./index.js";

function input(entry: string): BuildProviderInput {
  return {
    target: "react-native",
    unitName: "clients/mobile-browser",
    sourcePath: "/nonexistent",
    dependencyProjection: { nodeModulesPath: null, modules: {} },
    effectiveVersion: "ev",
    client: { id: "browser", runtime: "react-native", hostAbi: "rn-host-6", entry },
  };
}

describe("React Native build provider", () => {
  it("computes stream integrity from the artifact bytes", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rn-integrity-test-"));
    try {
      const filePath = path.join(tempDir, "artifact.bin");
      const bytes = Buffer.from([0, 1, 2, 127, 255]);
      fs.writeFileSync(filePath, bytes);

      expect(integrityForFile(filePath)).toBe(
        `sha256-${createHash("sha256").update(bytes).digest("hex")}`,
      );
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("builds the entry the client manifest names, not a host ABI of its own", async () => {
    const provider = await activate();
    await expect(provider.build(input("App.tsx"))).rejects.toThrow(
      "React Native builds require a Build V2 dependency projection",
    );
  });

  it("refuses an entry outside the client's source", async () => {
    const provider = await activate();
    await expect(provider.build(input("../../etc/passwd"))).rejects.toThrow(
      "declares an entry outside its source",
    );
  });
});
