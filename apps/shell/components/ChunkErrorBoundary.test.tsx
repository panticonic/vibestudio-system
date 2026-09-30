// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Theme } from "@radix-ui/themes";
import { afterEach, expect, it, vi } from "vitest";
const reporting = vi.hoisted(() => ({
  consent: vi.fn(async () => ({ state: "off", revision: 1 })),
  serverConsent: vi.fn(async () => null),
  history: vi.fn(async () => []),
  incidents: vi.fn(async () => []),
  availability: vi.fn(async () => ({ submissionAccess: "anonymous" })),
  send: vi.fn(),
}));
vi.mock("../shell/workspaceContext", () => ({
  useShellWorkspaceClient: () => ({ problemReports: reporting, app: {} }),
}));
vi.mock("../shell/useShellOverlay", () => ({ useShellOverlay: vi.fn() }));
import { ChunkErrorBoundary } from "./ChunkErrorBoundary";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("keeps reporting reachable when the main application cannot render, prefills the selected failure, and never sends implicitly", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const Broken = () => {
    throw new Error("Main desktop chunk unavailable");
  };
  render(
    <Theme>
      <ChunkErrorBoundary>
        <Broken />
      </ChunkErrorBoundary>
    </Theme>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Report this problem" }));
  expect(
    await screen.findByRole("textbox", { name: "What happened?" }),
  ).toHaveProperty(
    "value",
    "The Vibestudio shell failed to load: Main desktop chunk unavailable",
  );
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(reporting.send).not.toHaveBeenCalled();
});
