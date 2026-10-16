// @vitest-environment jsdom

import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatSession } from "./session";
import { fakeHost } from "./testing";

const sessions = vi.hoisted(() => ({ openChatSession: vi.fn() }));
vi.mock("./session", () => sessions);
vi.mock("./ChatWorkspace", () => ({
  ChatWorkspace: ({ session }: { session: ChatSession }) => (
    <div data-testid="workspace">{session.workspaceId}</div>
  ),
}));

import { mountChat } from "./mount";

function fakeSession(workspaceId = "personal-ws") {
  return { workspaceId, close: vi.fn() } as unknown as ChatSession;
}

function stubMatchMedia() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  });
}

function install(fake: ReturnType<typeof fakeHost>) {
  const g = globalThis as Record<string, unknown>;
  g["__vibestudioClient"] = fake.host.client;
  g["__vibestudioTransport"] = fake.host.transport;
  g["__vibestudioWorkspaceConnection"] = fake.host.connection;
}

async function mountWindow(scope?: object): Promise<() => void> {
  const container = document.body.appendChild(document.createElement("div"));
  let unmount!: () => void;
  await act(async () => {
    unmount = scope ? mountChat(container, scope) : mountChat(container);
  });
  return unmount;
}

describe("mountChat", () => {
  beforeEach(() => {
    sessions.openChatSession.mockReset();
    stubMatchMedia();
  });
  afterEach(() => {
    cleanup();
    for (const key of ["__vibestudioClient", "__vibestudioTransport", "__vibestudioWorkspaceConnection"])
      delete (globalThis as Record<string, unknown>)[key];
    document.body.innerHTML = "";
  });

  it("opens the Personal session through the host bridges and shows the workspace", async () => {
    const fake = fakeHost();
    install(fake);
    sessions.openChatSession.mockResolvedValue(fakeSession());
    await mountWindow();

    expect(await screen.findByTestId("workspace")).toHaveProperty("textContent", "personal-ws");
    expect(sessions.openChatSession).toHaveBeenCalledWith(
      expect.objectContaining({ open: expect.any(Function) }),
      fake.host.transport.identity
    );
  });

  it("reports a failed open with Retry, which opens again", async () => {
    install(fakeHost());
    sessions.openChatSession.mockRejectedValueOnce(new Error("Hub unreachable"));
    sessions.openChatSession.mockResolvedValue(fakeSession());
    await mountWindow();

    expect(await screen.findByText("Hub unreachable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByTestId("workspace")).toBeTruthy();
    expect(sessions.openChatSession).toHaveBeenCalledTimes(2);
  });

  it("does not adopt a session that finished opening after the window went away", async () => {
    install(fakeHost());
    let finish!: (session: ChatSession) => void;
    sessions.openChatSession.mockReturnValue(new Promise<ChatSession>((resolve) => (finish = resolve)));
    const unmount = await mountWindow();
    await act(async () => {
      unmount();
    });
    await act(async () => {
      finish(fakeSession());
    });
    expect(screen.queryByTestId("workspace")).toBeNull();
  });

  it("refuses to run outside a desktop client window", async () => {
    await expect(mountWindow({})).rejects.toThrow(/not running inside a Vibestudio desktop client window/);
  });
});
