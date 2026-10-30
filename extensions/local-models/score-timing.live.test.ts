import os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { activate } from "./index.js";
import { LFM3_MODEL } from "./constants.js";

const disposables: Array<{ dispose(): void | Promise<void> }> = [];
afterEach(async () => {
  await Promise.allSettled(disposables.splice(0).map((d) => d.dispose()));
});

describe.runIf(process.env["RUN_LOCAL_MODELS_E2E"] === "1")("score timing", () => {
  it("times decision scoring", async () => {
    const api = await activate({
      log: { info: () => {} },
      emit: () => {},
      subscriptions: { push: (d: { dispose(): void | Promise<void> }) => void disposables.push(d) },
      invocation: { current: () => ({ requestId: "t", extensionName: "@workspace-extensions/local-models", method: "attestRuntime", caller: { callerKind: "server" as const, callerId: "main" } }) },
    } as never);
    await api.installModel(LFM3_MODEL.ref);
    await api.ensureLoaded(LFM3_MODEL.ref);
    const context = "The program decides how to route a support ticket. ".repeat(120);
    const choices = ["escalate to billing", "escalate to engineering", "ask the customer for logs", "close as duplicate", "refund the order", "schedule a call", "tag as feature request", "no action"];
    const items = (variant: number) => [{
      messages: [{ role: "system", content: context }, { role: "user", content: `Ticket ${variant}: the export button fails. What is the next step?` }],
      continuations: choices,
    }];
    const runs: number[] = [];
    let prompt_tokens: unknown;
    for (let i = 0; i < 6; i++) {
      const started = performance.now();
      const [result] = await api.scoreContinuations(LFM3_MODEL.ref, items(i));
      runs.push(Math.round(performance.now() - started));
      if (!result || "error" in result) throw new Error(JSON.stringify(result));
      prompt_tokens = (result as { prompt_tokens?: unknown }).prompt_tokens;
      expect(result.log_probs).toHaveLength(choices.length);
    }
    // A forced re-processing in the server log is a cold prefill of a prompt whose prefix should have been reused.
    const log = await api.tailServerLogLines("main", 4000);
    const count = (text: string) => log.filter((line) => line.includes(text)).length;
    console.log(
      "score-timing",
      JSON.stringify({
        ms: runs,
        prompt_tokens,
        reprocessed: count("forcing full prompt re-processing"),
        loadavg: os.loadavg().map((n) => Number(n.toFixed(2))),
        cpus: os.cpus().length,
      }),
    );
    if (process.env["SCORE_TIMING_LOG"]) console.log(log.filter((line) => /slot|srv/u.test(line)).join("\n"));
  }, 600_000);
});
