// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { Theme } from "@radix-ui/themes";
import { afterEach, expect, it, vi } from "vitest";
import { ChunkErrorBoundary } from "./ChunkErrorBoundary";
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("offers retry when the shell cannot mount and directs reporting to the agent after recovery", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  let broken = true;
  const Application = () => {
    if (broken) throw new Error("Main desktop chunk unavailable");
    return <p>Recovered application</p>;
  };
  render(
    <Theme>
      <ChunkErrorBoundary
        onRetry={() => {
          broken = false;
        }}
      >
        <Application />
      </ChunkErrorBoundary>
    </Theme>,
  );
  expect(
    screen.getByText(
      "After retrying, ask an agent to help report this problem.",
    ),
  ).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(screen.getByText("Recovered application")).toBeTruthy();
});
