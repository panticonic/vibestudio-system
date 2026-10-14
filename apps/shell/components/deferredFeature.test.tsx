// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { Theme } from "@radix-ui/themes";
import { describe, expect, it, vi } from "vitest";
import { deferredFeature } from "./deferredFeature";

describe("operation-owned feature loading", () => {
  it("does not import a closed operation and loads its real component when opened", async () => {
    const load = vi.fn(async () => ({
      default: ({ label }: { label: string }) => <div>{label}</div>,
    }));
    const Feature = deferredFeature(load);
    const tree = (open: boolean) => (
      <Theme>{open ? <Feature label="Actual feature" /> : null}</Theme>
    );
    const view = render(tree(false));
    expect(load).not.toHaveBeenCalled();
    view.rerender(tree(true));
    expect(await screen.findByText("Actual feature")).toBeTruthy();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("retains the original failure and retries the same operation with a fresh lazy attempt", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("Original chunk failure");
    const load = vi.fn(async () => ({ default: () => <div>Recovered feature</div> }));
    load.mockRejectedValueOnce(failure);
    const Feature = deferredFeature(load);
    try {
      render(
        <Theme>
          <Feature />
        </Theme>
      );
      expect(await screen.findByText(failure.message)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Retry", exact: true }));
      expect(await screen.findByText("Recovered feature")).toBeTruthy();
      expect(load).toHaveBeenCalledTimes(2);
    } finally {
      error.mockRestore();
    }
  });
});
