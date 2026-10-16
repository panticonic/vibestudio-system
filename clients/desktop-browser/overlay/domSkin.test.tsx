// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createDomSkin } from "./domSkin";
import { transcriptCards } from "@workspace/quickfire-core";
import {
  QuickfireSkinProvider,
  Transcript,
} from "@workspace/quickfire-core/ui";

afterEach(cleanup);

it.each([
  ["search", "search"],
  ["copy", "copy"],
  ["expand", "chevrons-up-down"],
  ["collapse", "chevrons-down-up"],
] as const)("renders the %s history control glyph", (name, icon) => {
  const { Icon } = createDomSkin({ openLink: vi.fn() });
  const { container } = render(<Icon name={name} tone="muted" />);
  expect(container.querySelector(`svg.lucide-${icon}`)).not.toBeNull();
});

it("keeps streaming reasoning compact until explicitly expanded", () => {
  const cards = transcriptCards(
    [
      {
        kind: "thinking",
        id: "reasoning",
        streaming: true,
        text: "Checking the console.\nInspecting the failing setup watcher.",
      },
    ],
    { now: Date.now() },
  );
  const { container, getByLabelText, getByText } = render(
    <QuickfireSkinProvider value={createDomSkin({ openLink: vi.fn() })}>
      <Transcript cards={cards} />
    </QuickfireSkinProvider>,
  );
  expect(container.textContent).not.toContain("ReasoningReasoning");
  const disclosure = container.querySelector("details")!;
  expect(disclosure.open).toBe(false);
  fireEvent.click(
    getByLabelText("Reasoning: Inspecting the failing setup watcher."),
  );
  expect(disclosure.open).toBe(true);
  expect(getByText("Checking the console.", { exact: false })).toBeTruthy();
});
