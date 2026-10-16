import { describe, expect, it, vi } from "vitest";
import { TerminalOwnership, type TerminalStreams } from "./terminal.js";

function streams(raw = false) {
  const stdin = {
    isRaw: raw,
    setRawMode: vi.fn(function (this: { isRaw: boolean }, enabled: boolean) {
      this.isRaw = enabled;
    }),
    resume: vi.fn(),
    pause: vi.fn(),
  };
  const writes: string[] = [];
  const stdout = {
    write: vi.fn((bytes: string) => {
      writes.push(bytes);
      return true;
    }),
  };
  return {
    stdin,
    stdout,
    writes,
    terminal: new TerminalOwnership({ stdin, stdout } as unknown as TerminalStreams),
  };
}

describe("terminal ownership", () => {
  it("attempts every restoration step and retains each independent failure", () => {
    const { terminal, stdin, stdout } = streams();
    terminal.acquire({ mouse: false });
    const output = new Error("output restoration failed");
    const raw = new Error("raw restoration failed");
    const pause = new Error("input pause failed");
    stdout.write.mockImplementation(() => {
      throw output;
    });
    stdin.setRawMode.mockImplementation(() => {
      throw raw;
    });
    stdin.pause.mockImplementation(() => {
      throw pause;
    });
    let failure: unknown;
    try {
      terminal.release();
    } catch (error) {
      failure = error;
    }
    expect((failure as AggregateError).errors).toEqual([output, raw, pause]);
  });
  it("registers exit ownership before taking keyboard modes and pops only its own stack once", () => {
    const { terminal, stdin, stdout, writes } = streams(true);
    const before = process.listenerCount("exit");
    stdout.write.mockImplementation((bytes) => {
      expect(process.listenerCount("exit")).toBe(before + 1);
      writes.push(bytes);
      return true;
    });
    try {
      terminal.acquire({ mouse: false });
    } finally {
      stdout.write.mockImplementation((bytes) => {
        writes.push(bytes);
        return true;
      });
      terminal.release();
    }
    terminal.release();
    expect(writes.filter((bytes) => bytes.includes("\x1b[>1u"))).toHaveLength(1);
    expect(writes.filter((bytes) => bytes.includes("\x1b[<u"))).toHaveLength(1);
    expect(stdin.isRaw).toBe(true);
    expect(process.listenerCount("exit")).toBe(before);
  });

  it("restores a partially acquired keyboard before an acquisition failure escapes", () => {
    const { terminal, stdin, stdout, writes } = streams();
    const failure = new Error("keyboard write failed");
    const before = process.listenerCount("exit");
    stdout.write.mockImplementation((bytes) => {
      writes.push(bytes);
      if (bytes.includes("\x1b[>1u")) throw failure;
      return true;
    });
    expect(() => terminal.acquire({ mouse: true })).toThrow(failure);
    expect(writes.some((bytes) => bytes.includes("\x1b[<u"))).toBe(true);
    expect(stdin.isRaw).toBe(false);
    expect(stdin.pause).toHaveBeenCalledOnce();
    expect(process.listenerCount("exit")).toBe(before);
  });

  it("does not pop the parent keyboard when raw-mode acquisition failed before pushing", () => {
    const { terminal, stdin, writes } = streams();
    stdin.setRawMode.mockImplementationOnce(() => {
      throw new Error("raw mode failed");
    });
    expect(() => terminal.acquire({ mouse: false })).toThrow("raw mode failed");
    expect(writes.some((bytes) => bytes.includes("\x1b[<u"))).toBe(false);
  });

  it("retains the original acquisition failure and independent restoration failure", () => {
    const { terminal, stdout } = streams();
    const failure = new Error("acquire failed");
    const cleanup = new Error("restore failed");
    stdout.write.mockImplementation((bytes) => {
      throw bytes.includes("\x1b[?1049h") ? failure : cleanup;
    });
    let reported: unknown;
    try {
      terminal.acquire({ mouse: false });
    } catch (error) {
      reported = error;
    }
    expect(reported).toBeInstanceOf(AggregateError);
    expect((reported as AggregateError).errors).toEqual([failure, cleanup]);
    expect((reported as Error).cause).toBe(failure);
  });
});
