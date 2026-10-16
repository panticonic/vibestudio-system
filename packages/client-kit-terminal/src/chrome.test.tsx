import { describe, expect, it } from "vitest";
// Ink reads CI at load time; the harness clears it first, so it is imported before anything that loads Ink.
import { renderToText } from "./testing/renderToText.js";
import type { WorkspaceModelState } from "@workspace/workspace-core";
import {
  ClientUpdatePrompt,
  clientUpdateButtons,
  terminalPendingUpdate,
} from "./ClientUpdatePrompt.js";
import { ConnectionStatus, connectionStatusText } from "./ConnectionStatus.js";
import { WorkspacePicker, workspacePickerItems } from "./WorkspacePicker.js";

describe("terminal connection status", () => {
  it("words each phase for a status line, lower-case, with its cause", () => {
    expect(connectionStatusText({ phase: "online", everOnline: true })).toEqual({
      text: "connected",
      color: "green",
    });
    expect(connectionStatusText({ phase: "reconnecting", everOnline: true, reason: "socket closed" })).toEqual({
      text: "reconnecting (socket closed)",
      color: "yellow",
    });
    expect(connectionStatusText({ phase: "ended", everOnline: true, reason: "server gone" })).toEqual({
      text: "disconnected (server gone)",
      color: "red",
    });
    expect(renderToText(<ConnectionStatus view={{ phase: "online", everOnline: true }} />)).toContain("connected");
  });
});

describe("terminal workspace picker", () => {
  const state = (overrides: Partial<WorkspaceModelState> = {}): WorkspaceModelState => ({
    list: {
      status: "ready",
      workspaces: [
        { id: "a", name: "Alpha" },
        { id: "b", name: "Beta" },
      ],
    },
    query: "",
    currentId: "a",
    switchingTo: null,
    switchError: undefined,
    ...overrides,
  });
  const noRank = (entries: Parameters<Parameters<typeof workspacePickerItems>[1]>[0]) => entries;

  it("lists the workspaces in the host's order and hints the current one", () => {
    const items = workspacePickerItems(state(), noRank);
    expect(items.map((item) => [item.label, item.hint])).toEqual([
      ["Alpha", "current"],
      ["Beta", undefined],
    ]);
    const frame = renderToText(
      <WorkspacePicker state={state()} items={items} selected={1} width={60} height={10} rank={noRank} />
    );
    expect(frame).toContain("Switch workspace");
    expect(frame).toContain("Beta");
    expect(frame).toContain("Enter switch");
  });

  it("says why there is nothing to pick", () => {
    const loading = state({ list: { status: "loading", workspaces: null } });
    expect(
      renderToText(
        <WorkspacePicker state={loading} items={[]} selected={0} width={60} height={10} rank={noRank} />
      )
    ).toContain("Loading workspaces…");
    const failed = state({ list: { status: "failed", workspaces: null, error: new Error("hub down") } });
    expect(
      renderToText(
        <WorkspacePicker state={failed} items={[]} selected={0} width={60} height={10} rank={noRank} />
      )
    ).toContain("Could not list workspaces: hub down");
  });
});

describe("terminal update prompt", () => {
  const update = {
    clientId: "clients/chat-terminal",
    source: "clients/chat-terminal",
    runtime: "terminal" as const,
    buildKey: "b2",
    toVersion: "2",
    fromVersion: "1",
    canRollback: true,
  };

  it("names what is ready and offers a restart or later", () => {
    expect(clientUpdateButtons(update).map((button) => button.label)).toEqual([
      "[r] Restart now",
      "[l] Later",
    ]);
    const frame = renderToText(<ClientUpdatePrompt update={update} width={80} />);
    expect(frame).toContain("Update ready");
    expect(frame).toContain("clients/chat-terminal v1 → v2 is ready to install.");
    expect(frame).toContain("[r] Restart now");
  });

  it("shows what a terminal host reports as ready, offering no rollback", () => {
    const pending = terminalPendingUpdate(
      { id: "browser", source: "clients/terminal-browser" },
      { buildKey: "b3", effectiveVersion: "3" }
    );
    expect(pending).toEqual({
      clientId: "browser",
      source: "clients/terminal-browser",
      runtime: "terminal",
      buildKey: "b3",
      toVersion: "3",
      fromVersion: null,
      canRollback: false,
    });
    expect(renderToText(<ClientUpdatePrompt update={pending} width={80} />)).toContain(
      "browser v3 is ready to install."
    );
  });
});
