// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePanelReload } from "./usePanelReload.js";

afterEach(cleanup);

describe("panel reload command", () => {
  it("shows preparation immediately and shares repeated requests for a slot", async () => {
    let finish!: () => void;
    const perform = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = renderHook(() => usePanelReload(perform));
    let first!: Promise<unknown>;
    let repeated!: Promise<unknown>;
    act(() => {
      first = result.current.reload("chat");
      repeated = result.current.reload("chat");
    });
    expect(result.current.pending.has("chat")).toBe(true);
    expect(first).toBe(repeated);
    await act(async () => {});
    expect(perform).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish();
      await first;
    });
    expect(result.current.pending.size).toBe(0);
  });

  it("keeps other slots pending when one request fails and allows retry", async () => {
    let fail!: (cause: Error) => void;
    let finishOther!: () => void;
    const perform = vi.fn((id: string) =>
      id === "chat"
        ? new Promise<void>((_resolve, reject) => {
            fail = reject;
          })
        : new Promise<void>((resolve) => {
            finishOther = resolve;
          }),
    );
    const { result } = renderHook(() => usePanelReload(perform));
    let chat!: Promise<unknown>;
    let other!: Promise<unknown>;
    act(() => {
      chat = result.current.reload("chat");
      other = result.current.reload("other");
    });
    const failed = expect(chat).rejects.toThrow("build failed");
    await act(async () => {});
    await act(async () => {
      fail(new Error("build failed"));
      await failed;
    });
    expect([...result.current.pending]).toEqual(["other"]);
    perform.mockImplementation(async () => {});
    await act(async () => {
      await result.current.reload("chat");
    });
    expect(perform).toHaveBeenCalledTimes(3);
    await act(async () => {
      finishOther();
      await other;
    });
    expect(result.current.pending.size).toBe(0);
  });
});
