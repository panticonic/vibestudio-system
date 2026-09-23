// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { createDomSkin } from "./domSkin";

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
