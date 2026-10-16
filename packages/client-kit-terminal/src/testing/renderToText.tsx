import { afterAll, vi } from "vitest";
import React from "react";
import { render } from "ink";
import { Writable } from "node:stream";

// Ink selects a non-rendering log sink when CI is present at module-load time,
// even when the caller supplies an in-memory stream in debug mode. Keep this
// renderer test independent of the outer process environment while continuing
// to exercise Ink's real non-TTY output path.
const inheritedCi = vi.hoisted(() => {
  const value = process.env["CI"];
  delete process.env["CI"];
  return value;
});

afterAll(() => {
  if (inheritedCi === undefined) delete process.env["CI"];
  else process.env["CI"] = inheritedCi;
});

/**
 * A minimal, non-TTY Ink render harness. There is no `ink-testing-library` in
 * this workspace, so this renders through Ink's real `debug` mode (the same
 * mode it uses for CI output) into an in-memory stream and returns the last
 * frame. A non-TTY stdout also makes chalk/ink skip ANSI styling entirely, so
 * the captured frame is already plain text.
 */
export function renderToText(node: React.ReactElement): string {
  const frames: string[] = [];
  const stdout = new Writable({
    write(chunk, _enc, callback) {
      frames.push(chunk.toString());
      callback();
    },
  }) as unknown as NodeJS.WriteStream;
  Object.assign(stdout, { columns: 100, isTTY: false });
  const stdin = new Writable({
    write(_chunk, _enc, callback) {
      callback();
    },
  }) as unknown as NodeJS.ReadStream;
  Object.assign(stdin, {
    isTTY: false,
    setRawMode: () => stdin,
    setEncoding: () => stdin,
    read: () => null,
    ref: () => stdin,
    unref: () => stdin,
  });

  const { unmount } = render(node, { stdout, stdin, debug: true, patchConsole: false });
  unmount();
  return frames[frames.length - 2] ?? frames[frames.length - 1] ?? "";
}
