import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  clientUnitManifestDescriptor,
  readAndValidateUnitManifest,
} from "@vibestudio/shared/unitManifest";
import {
  CLIENT_CAPABILITY_CATALOG,
  DEVICE_LEVEL_CAPABILITIES,
  type ClientManifestBlock,
} from "@vibestudio/workspace-contracts/clients";

const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const systemRoot = path.resolve(clientRoot, "../..");

const manifest = readAndValidateUnitManifest(
  clientUnitManifestDescriptor,
  path.join(clientRoot, "package.json"),
  { unitName: "clients/chat-desktop" },
  readFileSync
) as { client: ClientManifestBlock; authority: { requests: unknown[] } };
const block = manifest.client;

const meta = readFileSync(path.join(systemRoot, "meta/vibestudio.yml"), "utf8");

describe("chat-desktop manifest", () => {
  it("is a web client of the desktop host's ABI and shares the chat product id", () => {
    expect(block).toMatchObject({ id: "chat", runtime: "web", hostAbi: "web-host-1" });
    expect(block.entry).toBe("src/index.tsx");
  });

  it("asks only for the capabilities its code uses, all of them desktop's", () => {
    expect(block.capabilities).toEqual({
      required: ["device-session", "hub-control", "approval-surface"],
      optional: ["native-menus", "global-shortcut", "integration.install"],
    });
    for (const capability of [
      ...(block.capabilities?.required ?? []),
      ...(block.capabilities?.optional ?? []),
    ]) {
      expect(CLIENT_CAPABILITY_CATALOG[capability].hosts).toContain("desktop");
    }
    // The chat hosts no panels: it must not hold the capability that grants that.
    expect(block.capabilities?.required).not.toContain("panel-hosting");
  });

  it("declares open-conversation and the shared background ask", () => {
    expect(block.intents).toEqual([
      expect.objectContaining({
        name: "open-conversation",
        kind: "foreground",
        params: { conversation: "string" },
      }),
      expect.objectContaining({
        name: "ask",
        kind: "background",
        params: { text: "text" },
        handler: "vibestudio.quickfire.v1#ask",
      }),
    ]);
    expect(block.intents?.find((intent) => intent.name === "ask")).not.toHaveProperty("result");
  });

  it("gives its window a size", () => {
    expect(block.integration?.desktop).toEqual({
      width: 1080,
      height: 760,
      minWidth: 560,
      minHeight: 420,
    });
  });

  it("is listed in the System template and trusted, because it holds device-level capabilities", () => {
    expect(meta).toMatch(/^clients:\n(?:  - source: .+\n)*  - source: clients\/chat-desktop$/m);
    expect(meta).toMatch(/^trust:\n  clients:\n(?:    - .+\n)*    - clients\/chat-desktop$/m);
    const deviceLevel = (block.capabilities?.required ?? []).filter((capability) =>
      DEVICE_LEVEL_CAPABILITIES.includes(capability)
    );
    expect(deviceLevel.length).toBeGreaterThan(0);
  });

  it("is not the desktop default", () => {
    expect(meta).toMatch(/^  desktop: clients\/desktop-browser$/m);
  });

  it("names the quickfire service its ask handler runs in", () => {
    expect(JSON.stringify(manifest.authority.requests)).toContain("workspace-service:quickfire");
  });
});
