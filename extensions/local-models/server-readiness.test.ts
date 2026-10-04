import { describe, expect, it } from "vitest";
import { ServerReadiness } from "./server-readiness.js";

describe("actual local server readiness", () => {
  it("uses split native announcements as a cue and authenticates actual HTTP readiness", async () => {
    let ready = false;
    let checks = 0;
    const state = new ServerReadiness(async () => {
      checks++;
      return ready;
    });
    state.start();
    await state.join();
    let admitted = false;
    const promise = state.ready.then(() => {
      admitted = true;
    });
    state.observe("srv llama_server: liste");
    await Promise.resolve();
    expect(admitted).toBe(false);
    ready = true;
    state.observe("ning on http://127.0.0.1:49152\n");
    await promise;
    expect(checks).toBe(2);
  });

  it("retains the original post-announcement protocol failure", async () => {
    const original = new Error(
      "Original authenticated readiness request failed",
    );
    const state = new ServerReadiness(async () => {
      throw original;
    });
    state.start();
    await state.join();
    const refused = expect(state.ready).rejects.toBe(original);
    state.observe("srv llama_server: listening on http://127.0.0.1:49152");
    await refused;
  });

  it("settles on explicit disposal and joins the actual outstanding readiness request", async () => {
    let release!: () => void;
    const body = new Promise<void>((resolve) => {
      release = resolve;
    });
    let signal: AbortSignal | undefined;
    const state = new ServerReadiness(async (actual) => {
      signal = actual;
      await body;
      return true;
    });
    state.start();
    const original = new Error("Actual owner disposed");
    const refused = expect(state.ready).rejects.toBe(original);
    state.fail(original);
    await refused;
    expect(signal?.aborted).toBe(true);
    let joined = false;
    const joining = state.join().then(() => {
      joined = true;
    });
    await Promise.resolve();
    expect(joined).toBe(false);
    release();
    await joining;
    expect(joined).toBe(true);
  });
});
