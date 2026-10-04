// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuickfireOwner } from "./QuickfireOwner";

const api = vi.hoisted(() => ({
  events: new Map<string, (payload?: unknown) => void>(),
  bindings: [] as Array<string | null>,
  intent: null as null | ((payload: unknown) => void),
  focused: "panel-a",
  chrome: vi.fn(),
  reportFailure: vi.fn(),
  list: vi.fn(async () => [] as Array<{ slotId: string; promotedAt: null }>),
}));
vi.mock("../shell/workspaceContext", () => {
  const client = {
    app: {},
    panel: {
      getFocusedPanelId: async () => api.focused,
      getChromeState: api.chrome,
      focus: async () => {},
      listPinnedPanelIds: async () => [],
      getRootGroups: async () => ({ groups: [] }),
    },
    quickfire: { list: api.list },
    hostCommands: { list: async () => [] },
    userNotifications: {},
    workspace: { list: async () => [] },
  };
  return {
    useWorkspaceNavigationHost: () => null,
    useShellWorkspaceClient: () => client,
  };
});
vi.mock("../shell/useShellEvent", async () => {
  const { useEffect } = await import("react");
  return {
    useShellEvent: (name: string, callback: (payload?: unknown) => void) => {
      useEffect(() => {
        api.events.set(name, callback);
        return () => {
          api.events.delete(name);
        };
      }, [name, callback]);
    },
  };
});
vi.mock("../shell/useShellContentOverlay", () => ({
  useShellContentOverlay: (_options: unknown, intent: typeof api.intent) => {
    api.intent = intent;
  },
}));
vi.mock("./NavigationContext", () => ({
  useNavigationActions: () => ({
    navigateToId: vi.fn(),
    setAddressBarVisible: vi.fn(),
  }),
}));
vi.mock("../commands/slate", () => ({
  buildSlate: () => [],
  reportCommandFailure: api.reportFailure,
  runContributedCommand: vi.fn(),
}));
vi.mock("./useQuickfireSession", () => ({
  useQuickfireSession: (source: { kind: string; slotId?: string } | null) => {
    api.bindings.push(source?.slotId ?? null);
    return {
      view: {
        hasConversation: Boolean(source),
        promoted: false,
        transcript: [],
        modelSelection: { choices: [] },
        resume: null,
        olderCount: 0,
        connecting: false,
        streaming: false,
        error: null,
      },
    };
  },
}));

function chrome(panelId: string) {
  return { panelId, title: panelId, source: "about/new", kind: "workspace" };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function open() {
  await act(async () => {
    api.events.get("open-command-agent")?.({ mode: "quickfire" });
  });
}
function dismiss() {
  act(() => {
    api.intent?.({ type: "dismiss" });
  });
}

beforeEach(() => {
  api.events.clear();
  api.bindings = [];
  api.focused = "panel-a";
  api.chrome.mockReset().mockImplementation(async (id: string) => chrome(id));
  api.list.mockReset().mockResolvedValue([]);
  api.reportFailure.mockReset();
});
afterEach(cleanup);

describe("Quickfire opening ownership", () => {
  it("reopens on the new panel before its chrome read finishes, without binding the old session", async () => {
    render(<QuickfireOwner />);
    await open();
    await waitFor(() => expect(api.bindings.at(-1)).toBe("panel-a"));
    dismiss();
    const pending = deferred<ReturnType<typeof chrome>>();
    api.focused = "panel-b";
    api.chrome.mockReturnValue(pending.promise);
    api.bindings = [];
    await open();
    expect(api.bindings).not.toContain("panel-a");
    expect(api.bindings.at(-1)).toBe("panel-b");
    await act(async () => {
      pending.resolve(chrome("panel-b"));
    });
    expect(api.bindings.at(-1)).toBe("panel-b");
  });

  it("ignores a chrome response from an opening that was dismissed", async () => {
    const pending = deferred<ReturnType<typeof chrome>>();
    api.chrome.mockImplementation((id: string) =>
      id === "panel-a" ? pending.promise : Promise.resolve(chrome(id)),
    );
    render(<QuickfireOwner />);
    await open();
    dismiss();
    api.focused = "panel-b";
    await open();
    await act(async () => {
      pending.resolve(chrome("panel-a"));
    });
    expect(api.bindings.at(-1)).toBe("panel-b");
  });

  it("reports chrome read failures without treating the panel as closed", async () => {
    render(<QuickfireOwner />);
    await open();
    const failure = new Error("Connection disconnected");
    api.chrome.mockRejectedValueOnce(failure);
    await act(async () => {
      api.events.get("panel-tree-invalidated")?.({ removedSlotIds: [] });
    });
    expect(api.reportFailure).toHaveBeenCalled();
    expect(api.bindings.at(-1)).toBe("panel-a");
  });

  it("unbinds when the target panel is explicitly removed", async () => {
    render(<QuickfireOwner />);
    await open();
    act(() => {
      api.events.get("panel-tree-invalidated")?.({ removedSlotIds: ["panel-a"] });
    });
    expect(api.bindings.at(-1)).toBe(null);
  });

  it("does not revive an opening dismissed while acquiring panel focus", async () => {
    render(<QuickfireOwner />);
    act(() => {
      api.events.get("open-command-agent")?.({ mode: "quickfire" });
      api.intent?.({ type: "dismiss" });
    });
    await act(async () => {});
    expect(api.bindings.every((binding) => binding === null)).toBe(true);
  });
});
