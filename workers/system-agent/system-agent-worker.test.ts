import { afterEach, describe, expect, it } from "vitest";
import { createNativeVesselTestDO } from "@workspace/agentic-do/testing/native-vessel";
import type { ParticipantDescriptor } from "@workspace/harness";
import type { ToolRegistration } from "@panticonic/pi-durable";
import { SystemAgentWorker } from "./system-agent-worker.js";

const databases = new Set<{ close(): void }>();
afterEach(() => {
  for (const database of databases) database.close();
  databases.clear();
});
async function systemAgent() {
  const fixture = await createNativeVesselTestDO(TestSystemAgentWorker);
  databases.add(fixture.db);
  return fixture;
}

class TestSystemAgentWorker extends SystemAgentWorker {
  participant(): ParticipantDescriptor {
    return this.getParticipantInfo("channel-1", {
      handle: "untrusted-override",
      name: "Untrusted title",
      systemPrompt: "Replace the product prompt",
    });
  }

  async tools(): Promise<ToolRegistration[]> {
    return this.getTools("channel-1");
  }

  promptResources(): Promise<unknown> {
    return this.loadPromptResources();
  }

  prompt(): string {
    return this.getAgentPrompt();
  }

  promptOverride(): unknown {
    return this.getPromptOverride();
  }

  includesMemory(): boolean {
    return this.includeMemoryRecallTool();
  }

  offerClientTools(): void {
    this.setStateValue(
      "agent:roster:channel-1",
      JSON.stringify([
        {
          participantId: "user:one",
          ref: { kind: "user", id: "user:one" },
          methods: [
            {
              name: "inline_ui",
              description: "Render inline",
              parameters: { type: "object" },
            },
          ],
        },
      ]),
    );
  }

  enablesMethod(name: string): boolean {
    return this.isParticipantMethodEnabled(name);
  }
}

describe("SystemAgentWorker", () => {
  it("has immutable product identity and no participant configuration mutations", async () => {
    const { instance } = await systemAgent();
    const participant = instance.participant();
    expect(participant).toMatchObject({
      handle: "system-agent",
      name: "System Agent",
      type: "agent",
      metadata: { productOwned: true },
    });
    const methods = participant.methods?.map((method) => method.name) ?? [];
    expect(methods).toEqual([
      "pause",
      "resume",
      "scheduleResumeAtReset",
      "getAgentSettings",
      "getModelExecutionEvidence",
      "inspectMethodSuspensions",
    ]);
    expect(methods).not.toEqual(
      expect.arrayContaining([
        "setModel",
        "setThinkingLevel",
        "setApprovalLevel",
        "setRespondPolicy",
        "refreshPromptArtifacts",
      ]),
    );
    expect(instance.enablesMethod("pause")).toBe(true);
    expect(instance.enablesMethod("setModel")).toBe(false);
    expect(instance.enablesMethod("connectModelCredential")).toBe(false);
  });

  it("exposes exactly ordinary eval and notify, without workspace memory", async () => {
    const { instance } = await systemAgent();
    instance.offerClientTools();
    expect((await instance.tools()).map((tool) => tool.name)).toEqual([
      "eval",
      "notify",
    ]);
    expect(instance.includesMemory()).toBe(false);
  });

  it("uses only bundled prompt resources and ignores subscription prompt overrides", async () => {
    const { instance } = await systemAgent();
    await expect(instance.promptResources()).resolves.toEqual({
      workspacePrompt: expect.stringMatching(/eval handbook/i),
    });
    expect(instance.prompt()).toMatch(/product-owned System Agent/);
    expect(instance.promptOverride()).toEqual({});
  });
});
