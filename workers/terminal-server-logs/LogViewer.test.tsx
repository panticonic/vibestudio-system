import { describe, expect, it } from "vitest";
import { TerminalEventDecoder } from "@workspace/terminal-host-protocol";
import { InkTerminalSessionHost } from "@workspace/terminal-shim";
import { LogViewer, type LogSource } from "./LogViewer.js";
import {
  appendRecords,
  visibleWindow,
  DEFAULT_FILTER,
  type LogFilter,
  type LogRecord,
} from "./logModel.js";

const record = (seq: number, level: LogRecord["level"], message: string): LogRecord => ({
  seq,
  timestamp: Date.UTC(2026, 9, 12, 12, 0, seq),
  level,
  message,
});

function fakeSource(initial: LogRecord[]) {
  let push: (records: LogRecord[]) => void = () => {};
  const source: LogSource = {
    tail: async () => initial,
    watch: (onBatch, signal) =>
      new Promise<void>((resolve) => {
        push = onBatch;
        signal.addEventListener("abort", () => resolve());
      }),
  };
  return { source, push: (records: LogRecord[]) => push(records) };
}

async function mount(source: LogSource, focused = true) {
  let saved: LogFilter = DEFAULT_FILTER;
  const attention: unknown[] = [];
  const host = new InkTerminalSessionHost({
    render: (session) => (
      <LogViewer
        source={source}
        filters={{ load: () => saved, save: (f) => (saved = f) }}
        session={{
          isFocused: session.isFocused,
          onFocusChange: session.onFocusChange,
          setAttention: (a) => {
            attention.push(a);
            session.setAttention(a);
          },
        }}
      />
    ),
  });
  const response = host.attach("app:1", {
    sessionId: "s",
    viewport: { columns: 60, rows: 8 },
    focused,
  });
  const reader = response.body!.getReader();
  const decoder = new TerminalEventDecoder();
  let output = "";
  void (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      for (const event of decoder.push(value)) if (event.type === "output") output += event.data;
    }
  })();
  const settle = () => new Promise((resolve) => setTimeout(resolve, 40));
  await settle();
  return {
    output: () => output,
    clear: () => (output = ""),
    type: async (data: string) => {
      host.input("app:1", "s", data);
      await settle();
    },
    settle,
    saved: () => saved,
    attention,
    detach: () => reader.cancel(),
  };
}

describe("log model", () => {
  it("deduplicates overlapping batches by seq", () => {
    const merged = appendRecords(
      [record(1, "info", "a"), record(2, "info", "b")],
      [record(2, "info", "b"), record(3, "info", "c")]
    );
    expect(merged.map((r) => r.seq)).toEqual([1, 2, 3]);
  });

  it("clamps the scroll window", () => {
    expect(visibleWindow([1, 2, 3, 4, 5], 2, 0).rows).toEqual([4, 5]);
    expect(visibleWindow([1, 2, 3, 4, 5], 2, 99)).toEqual({ rows: [1, 2], offset: 3 });
  });
});

describe("LogViewer", () => {
  it("shows the tail, follows live lines and filters by level", async () => {
    const { source, push } = fakeSource([
      record(1, "info", "server ready"),
      record(2, "verbose", "noise"),
    ]);
    const view = await mount(source);
    expect(view.output()).toContain("server ready");
    expect(view.output()).not.toContain("noise");

    push([record(3, "warn", "disk almost full")]);
    await view.settle();
    expect(view.output()).toContain("disk almost full");

    view.clear();
    await view.type("4");
    expect(view.output()).toContain("level ≥ error");
    expect(view.saved().minLevel).toBe("error");
    await view.detach();
  });

  it("searches and remembers the search", async () => {
    const { source } = fakeSource([record(1, "info", "alpha"), record(2, "info", "beta")]);
    const view = await mount(source);
    await view.type("/");
    await view.type("bet");
    await view.type("\r");
    expect(view.output()).toContain('matching "bet"');
    expect(view.saved().search).toBe("bet");
    await view.detach();
  });

  it("asks for attention on a new error only while unfocused", async () => {
    const { source, push } = fakeSource([]);
    const view = await mount(source, false);
    push([record(1, "error", "boom")]);
    await view.settle();
    expect(view.attention).toEqual([{ reason: "new server error" }]);
    await view.detach();
  });

  it("explains a failed load and how to retry", async () => {
    const source: LogSource = {
      tail: async () => {
        throw new Error("approval declined");
      },
      watch: async () => {},
    };
    const view = await mount(source);
    expect(view.output()).toContain("Could not read the server log: approval declined");
    expect(view.output()).toContain("Press r to try again");
    await view.detach();
  });
});
