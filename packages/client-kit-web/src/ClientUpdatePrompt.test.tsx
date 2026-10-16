// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createClientUpdateModel,
  type PendingClientUpdate,
} from "@workspace/client-update-core";
import { ClientUpdatePrompt } from "./ClientUpdatePrompt";

const update: PendingClientUpdate = {
  clientId: "browser",
  source: "clients/desktop-browser",
  runtime: "web",
  buildKey: "build-2",
  toVersion: "2.0.0",
  fromVersion: "1.0.0",
  canRollback: true,
};

function setup() {
  const port = {
    apply: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    rollback: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
  const model = createClientUpdateModel({ scope: { runtime: "web" }, port });
  model.seed([update]);
  render(<ClientUpdatePrompt model={model} />);
  return { model, port };
}

afterEach(cleanup);

describe("ClientUpdatePrompt", () => {
  it("renders nothing while no build is ready", () => {
    const model = createClientUpdateModel({
      scope: { runtime: "web" },
      port: { apply: vi.fn(), rollback: vi.fn() },
    });
    const { container } = render(<ClientUpdatePrompt model={model} />);
    expect(container.textContent).toBe("");
  });

  it("names the versions and applies through the port", async () => {
    const { port } = setup();
    expect(screen.getByText("browser v1.0.0 → v2.0.0 is ready to install.")).toBeTruthy();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Apply update" })));
    expect(port.apply).toHaveBeenCalledWith(update);
    expect(screen.queryByText(/is ready to install/)).toBeNull();
  });

  it("postpones without applying", () => {
    const { port } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(port.apply).not.toHaveBeenCalled();
    expect(screen.queryByText(/is ready to install/)).toBeNull();
  });

  it("keeps the update on offer and says why when applying fails", async () => {
    const { port } = setup();
    port.apply.mockRejectedValueOnce(new Error("Disk full"));
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Apply update" })));
    expect(screen.getByText(/Update failed/)).toBeTruthy();
    expect(screen.getByText(/Disk full/)).toBeTruthy();
    expect(screen.getByText(/is ready to install/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/Disk full/)).toBeNull();
  });
});
