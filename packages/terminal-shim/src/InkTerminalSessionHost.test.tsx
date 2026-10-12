import { describe, expect, it } from "vitest";
import React from "react";
import { Text, useInput } from "ink";
import {
  TerminalEventDecoder,
  bytesToBase64,
  type TerminalSessionEvent,
} from "@workspace/terminal-host-protocol";
import { InkTerminalSessionHost, type TerminalSessionHandle } from "./InkTerminalSessionHost.js";
import { useTerminalSize } from "./hooks.js";

/** Reads an attachment stream into a live event list. */
function collect(response: Response): {
  events: TerminalSessionEvent[];
  output: () => string;
  cancel: () => Promise<void>;
  done: Promise<void>;
} {
  const events: TerminalSessionEvent[] = [];
  const reader = response.body!.getReader();
  const decoder = new TerminalEventDecoder();
  const done = (async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      events.push(...decoder.push(value));
    }
  })();
  return {
    events,
    output: () =>
      events
        .filter((e): e is Extract<TerminalSessionEvent, { type: "output" }> => e.type === "output")
        .map((e) => e.data)
        .join(""),
    cancel: () => reader.cancel(),
    done,
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

function SizeProbe(): React.ReactElement {
  const { columns, rows } = useTerminalSize();
  return <Text>{`size=${columns}x${rows}`}</Text>;
}

function Echo(): React.ReactElement {
  const [text, setText] = React.useState("");
  useInput((input) => setText((t) => t + input));
  return <Text>{`typed:${text}`}</Text>;
}

describe("InkTerminalSessionHost", () => {
  it("keeps size and render state per session, even in one isolate", async () => {
    const a = new InkTerminalSessionHost({ render: () => <SizeProbe /> });
    const b = new InkTerminalSessionHost({ render: () => <SizeProbe /> });
    const sa = collect(
      a.attach("app:1", { sessionId: "a", viewport: { columns: 40, rows: 10 }, focused: true })
    );
    const sb = collect(
      b.attach("app:1", { sessionId: "b", viewport: { columns: 100, rows: 30 }, focused: false })
    );
    await settle();
    expect(sa.output()).toContain("size=40x10");
    expect(sb.output()).toContain("size=100x30");

    a.resize("app:1", "a", { columns: 60, rows: 12 });
    await settle();
    expect(sa.output()).toContain("size=60x12");
    expect(sb.output()).not.toContain("size=60x12");

    // Detaching one session leaves the other rendering.
    await sa.cancel();
    b.resize("app:1", "b", { columns: 90, rows: 20 });
    await settle();
    expect(sb.output()).toContain("size=90x20");
    await sb.cancel();
  });

  it("starts every attachment with a cleared screen and a full render", async () => {
    const host = new InkTerminalSessionHost({ render: () => <Text>hello</Text> });
    const first = collect(
      host.attach("app:1", { sessionId: "s", viewport: { columns: 20, rows: 5 }, focused: true })
    );
    await settle();
    await first.cancel();
    const second = collect(
      host.attach("app:1", { sessionId: "s", viewport: { columns: 20, rows: 5 }, focused: true })
    );
    await settle();
    expect(second.output().startsWith("\x1b[0m\x1b[2J")).toBe(true);
    expect(second.output()).toContain("hello");
    await second.cancel();
  });

  it("routes input to Ink and accepts it only from the attached caller", async () => {
    const host = new InkTerminalSessionHost({ render: () => <Echo /> });
    const s = collect(
      host.attach("app:1", { sessionId: "s", viewport: { columns: 30, rows: 5 }, focused: true })
    );
    await settle();
    host.input("app:1", "s", "hi");
    await settle();
    expect(s.output()).toContain("typed:hi");
    expect(() => host.input("do:intruder", "s", "x")).toThrow(/another terminal/);
    expect(() => host.input("app:1", "other", "x")).toThrow(/does not match/);
    await s.cancel();
    expect(() => host.input("app:1", "s", "x")).toThrow(/no attached terminal/);
  });

  it("supersedes an older attachment and tells it so", async () => {
    const host = new InkTerminalSessionHost({ render: () => <Text>x</Text> });
    const first = collect(
      host.attach("app:1", { sessionId: "s", viewport: { columns: 20, rows: 5 }, focused: true })
    );
    await settle();
    const second = collect(
      host.attach("app:2", { sessionId: "s", viewport: { columns: 20, rows: 5 }, focused: true })
    );
    await first.done;
    expect(first.events.at(-1)).toEqual({ type: "superseded" });
    expect(() => host.input("app:1", "s", "x")).toThrow(/another terminal/);
    host.input("app:2", "s", "x");
    await second.cancel();
  });

  it("round-trips host requests and declines them when the browser detaches", async () => {
    let handle!: TerminalSessionHandle;
    const host = new InkTerminalSessionHost({
      render: (h) => {
        handle = h;
        return <Text>x</Text>;
      },
    });
    const s = collect(
      host.attach("app:1", { sessionId: "s", viewport: { columns: 20, rows: 5 }, focused: true })
    );
    await settle();
    const opened = handle.openUrl("https://example.com");
    const file = handle.requestFile("Attach a log");
    await settle();
    const urlEvent = s.events.find((e) => e.type === "open-url") as Extract<
      TerminalSessionEvent,
      { type: "open-url" }
    >;
    const fileEvent = s.events.find((e) => e.type === "request-file") as Extract<
      TerminalSessionEvent,
      { type: "request-file" }
    >;
    expect(fileEvent.prompt).toBe("Attach a log");
    host.reply("app:1", "s", { requestId: urlEvent.requestId, kind: "open-url", opened: true });
    host.reply("app:1", "s", {
      requestId: fileEvent.requestId,
      kind: "request-file",
      file: { name: "a.txt", data: bytesToBase64(new TextEncoder().encode("abc")) },
    });
    await expect(opened).resolves.toBe(true);
    const chosen = await file;
    expect(chosen?.name).toBe("a.txt");
    expect(new TextDecoder().decode(chosen!.bytes)).toBe("abc");
    // Replies must answer an open request.
    expect(() =>
      host.reply("app:1", "s", { requestId: urlEvent.requestId, kind: "open-url", opened: true })
    ).toThrow(/open request/);

    const pending = handle.openUrl("https://example.org");
    await s.cancel();
    await expect(pending).resolves.toBe(false);
  });

  it("re-announces title and attention on reattach and ends on request", async () => {
    let handle!: TerminalSessionHandle;
    const host = new InkTerminalSessionHost({
      render: (h) => {
        handle = h;
        return <Text>x</Text>;
      },
    });
    const first = collect(
      host.attach("app:1", { sessionId: "s", viewport: { columns: 20, rows: 5 }, focused: false })
    );
    await settle();
    handle.setTitle("Logs\x1b]0;evil\x07");
    handle.setAttention({ reason: "new errors", bell: true });
    await settle();
    expect(first.events).toContainEqual({ type: "title", title: "Logs ]0;evil" });
    await first.cancel();
    const second = collect(
      host.attach("app:1", { sessionId: "s", viewport: { columns: 20, rows: 5 }, focused: true })
    );
    await settle();
    expect(second.events.slice(0, 2)).toEqual([
      { type: "title", title: "Logs ]0;evil" },
      { type: "attention", attention: { reason: "new errors", bell: true } },
    ]);
    handle.end("bye");
    await second.done;
    expect(second.events.at(-1)).toEqual({ type: "ended", reason: "bye" });
  });
});
