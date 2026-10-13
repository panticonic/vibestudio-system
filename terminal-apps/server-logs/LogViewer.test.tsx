import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { render, type Instance } from "ink";
import { LogViewer, type LogSource, type LogTerminal } from "./LogViewer.js";
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

class FakeStdout extends EventEmitter {
  columns = 60;
  rows = 8;
  output = "";
  write(data: string): boolean {
    this.output += data;
    return true;
  }
}

let instance: Instance | null = null;
afterEach(() => {
  instance?.unmount();
  instance = null;
});

async function mount(source: LogSource, focused = true) {
  let saved: LogFilter = DEFAULT_FILTER;
  const attention: string[] = [];
  const stdout = new FakeStdout();
  const stdin = Object.assign(new PassThrough(), {
    isTTY: true,
    setRawMode: () => undefined,
    ref: () => undefined,
    unref: () => undefined,
  });
  const terminal: LogTerminal = {
    size: () => ({ columns: 60, rows: 8 }),
    onResize: () => () => undefined,
    isFocused: () => focused,
    onFocusChange: () => () => undefined,
    requestAttention: (reason) => attention.push(reason),
  };
  let quit = false;
  instance = render(
    <LogViewer
      source={source}
      filters={{ load: () => saved, save: (f) => (saved = f) }}
      terminal={terminal}
      onQuit={() => (quit = true)}
    />,
    { stdout: stdout as never, stdin: stdin as never, debug: true, patchConsole: false }
  );
  const settle = () => new Promise((resolve) => setTimeout(resolve, 40));
  await settle();
  return {
    output: () => stdout.output,
    clear: () => (stdout.output = ""),
    type: async (data: string) => {
      stdin.write(data);
      await settle();
    },
    settle,
    saved: () => saved,
    attention,
    quit: () => quit,
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
  });

  it("searches and remembers the search", async () => {
    const { source } = fakeSource([record(1, "info", "alpha"), record(2, "info", "beta")]);
    const view = await mount(source);
    await view.type("/");
    await view.type("bet");
    await view.type("\r");
    expect(view.output()).toContain('matching "bet"');
    expect(view.saved().search).toBe("bet");
  });

  it("asks for attention on a new error only while unfocused", async () => {
    const { source, push } = fakeSource([]);
    const view = await mount(source, false);
    push([record(1, "error", "boom")]);
    await view.settle();
    expect(view.attention).toEqual(["new server error"]);
  });

  it("explains a failed load and how to retry, and quits on q", async () => {
    const source: LogSource = {
      tail: async () => {
        throw new Error("approval declined");
      },
      watch: async () => {},
    };
    const view = await mount(source);
    expect(view.output()).toContain("Could not read the server log: approval declined");
    expect(view.output()).toContain("Press r to try again");
    await view.type("q");
    expect(view.quit()).toBe(true);
  });
});
