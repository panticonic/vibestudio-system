// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QuickfireOwner } from "./QuickfireOwner";
import { createStore, Provider } from "jotai";
import { openCommandAgentAtom } from "../state/commandAgentAtoms";

const api = vi.hoisted(() => ({
  events: new Map<string, (payload?: unknown) => void>(),
  bindings: [] as Array<string | null>,
  intent: null as null | ((payload: unknown) => void),
  focused: "panel-a" as string | null,
  chrome: vi.fn(),
  reportFailure: vi.fn(),
  list: vi.fn(async () => [] as Array<{ slotId: string; promotedAt: null }>),
  focus: vi.fn(async () => {}),
  surface: null as null | { props: { mode: string; inputValue: string } },
}));
vi.mock("../shell/workspaceContext", () => {
  const client = {
    app: {},
    panel: {
      getFocusedPanelId: async () => api.focused,
      getChromeState: api.chrome,
      focus: api.focus,
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
  useShellContentOverlay: (
    options: typeof api.surface,
    intent: typeof api.intent,
  ) => {
    api.surface = options;
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
function renderOwnerWithHost() {
  const host = document.createElement("div");
  host.id = "app-quickfire-host:system";
  host.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 900,
    bottom: 800,
    width: 900,
    height: 800,
    toJSON: () => ({}),
  });
  document.body.appendChild(host);
  render(<QuickfireOwner />);
  return host;
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
  api.focus.mockClear();
  api.surface = null;
});
afterEach(cleanup);

describe("Quickfire opening ownership", () => {
  it("retains the conversation binding on dismissal and resumes it from the palette", async () => {
    const host = renderOwnerWithHost();
    await open();
    await waitFor(() => expect(api.bindings.at(-1)).toBe("panel-a"));
    dismiss();
    expect(api.bindings.at(-1)).toBe("panel-a");
    await act(async () => {
      api.events.get("open-command-palette")?.();
    });
    await waitFor(() => expect(api.surface?.props.mode).toBe("quickfire"));
    expect(api.bindings.at(-1)).toBe("panel-a");
    host.remove();
  });

  it("reopens the bound conversation when the overlay or window has no focused panel", async () => {
    const host = renderOwnerWithHost();
    await open();
    await waitFor(() => expect(api.bindings.at(-1)).toBe("panel-a"));
    dismiss();
    api.focused = null;
    await open();
    await waitFor(() => expect(api.surface?.props.mode).toBe("quickfire"));
    expect(api.bindings.at(-1)).toBe("panel-a");
    host.remove();
  });

  it("releases a dismissed conversation binding when its panel is destroyed", async () => {
    render(<QuickfireOwner />);
    await open();
    await waitFor(() => expect(api.bindings.at(-1)).toBe("panel-a"));
    dismiss();
    act(() =>
      api.events.get("panel-tree-invalidated")?.({
        removedSlotIds: ["panel-a"],
      }),
    );
    expect(api.bindings.at(-1)).toBeNull();
  });

  it("focuses a chrome request's source panel and opens its complete repair draft", async () => {
    const store = createStore();
    const host = document.createElement("div");
    host.id = "app-quickfire-host:system";
    host.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 900,
      bottom: 800,
      width: 900,
      height: 800,
      toJSON: () => ({}),
    });
    document.body.appendChild(host);
    try {
      render(
        <Provider store={store}>
          <QuickfireOwner />
        </Provider>,
      );
      const prompt =
        "Help me fix this error\n" + "full diagnostic\n".repeat(400);
      act(() =>
        store.set(openCommandAgentAtom, { panelId: "failed-panel", prompt }),
      );
      await waitFor(() =>
        expect(api.surface?.props.inputValue).toBe("/" + prompt),
      );
      expect(api.surface?.props.mode).toBe("quickfire");
      expect(api.focus).toHaveBeenCalledWith("failed-panel");
      expect(api.bindings.at(-1)).toBe("failed-panel");
    } finally {
      host.remove();
    }
  });
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
      api.events.get("panel-tree-invalidated")?.({
        removedSlotIds: ["panel-a"],
      });
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
