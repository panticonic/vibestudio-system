import { describe, expect, it } from "vitest";
import {
  TerminalEventDecoder,
  base64ToBytes,
  bytesToBase64,
  encodeSessionEvent,
  terminalSessionRpcMethods,
  type TerminalSessionEvent,
} from "./index.js";

describe("terminal session event stream", () => {
  it("round-trips events, including control characters, through NDJSON", () => {
    const events: TerminalSessionEvent[] = [
      { type: "output", data: "\x1b[2J\x1b[Hhello\nworld\x07" },
      { type: "title", title: "Logs" },
      { type: "attention", attention: { reason: "done", bell: true } },
      { type: "attention", attention: null },
      { type: "open-url", requestId: "r1", url: "https://example.com" },
      { type: "request-file", requestId: "r2" },
      { type: "ended", reason: "bye" },
      { type: "superseded" },
    ];
    const bytes = events.map(encodeSessionEvent);
    const joined = new Uint8Array(bytes.reduce((n, b) => n + b.length, 0));
    let offset = 0;
    for (const b of bytes) {
      joined.set(b, offset);
      offset += b.length;
    }
    // Split at arbitrary boundaries, including inside multi-byte sequences.
    const decoder = new TerminalEventDecoder();
    const decoded: TerminalSessionEvent[] = [];
    for (let i = 0; i < joined.length; i += 7)
      decoded.push(...decoder.push(joined.subarray(i, i + 7)));
    decoder.end();
    expect(decoded).toEqual(events);
  });

  it("rejects malformed and unknown events instead of skipping them", () => {
    expect(() => new TerminalEventDecoder().push(new TextEncoder().encode("{oops\n"))).toThrow(
      /malformed/
    );
    expect(() =>
      new TerminalEventDecoder().push(new TextEncoder().encode('{"type":"bogus"}\n'))
    ).toThrow(/unknown/);
    const truncated = new TerminalEventDecoder();
    truncated.push(new TextEncoder().encode('{"type":"title"'));
    expect(() => truncated.end()).toThrow(/middle of an event/);
  });

  it("has one method table with unprefixed, collision-free names", () => {
    const names = Object.values(terminalSessionRpcMethods).map((m) => m.name);
    expect(names).toEqual([
      "terminalAttach",
      "terminalInput",
      "terminalResize",
      "terminalFocus",
      "terminalReply",
      "terminalClose",
    ]);
  });

  it("base64-encodes large binary payloads", () => {
    const big = new Uint8Array(200_000).map((_, i) => i % 251);
    expect(base64ToBytes(bytesToBase64(big))).toEqual(big);
  });
});
