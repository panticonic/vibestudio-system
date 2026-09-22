// @vitest-environment jsdom

import {
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { QuickfireSurfaceProps } from "./quickfireSurfaceModel";
import { QuickfireSurface } from "./QuickfireSurface";
import { OverlayWindowContext } from "./OverlayWindowControls";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

const baseProps: QuickfireSurfaceProps = {
  mode: "quickfire",
  inputValue: "",
  inputEpoch: 1,
  placeholder: "Ask about this panel…",
  ghostSuffix: null,
  groups: [],
  selectedId: null,
  argSession: null,
  context: { title: "Task board" },
  emptyMessage: null,
  flashRowId: null,
  compose: {
    panelTitle: "Task board",
    hint: "Ask about this panel",
    transcriptOrder: "newest-first",
    disabledReason: null,
    transcript: [],
    olderCount: 0,
    expandable: false,
    loadingOlder: false,
    credentialRequest: null,
    resume: null,
    connecting: false,
    streaming: true,
    promoted: false,
    hasConversation: true,
    error: null,
  },
};

function renderSurface(
  compose: Partial<NonNullable<QuickfireSurfaceProps["compose"]>> = {},
  emitIntent = vi.fn(),
) {
  render(
    <QuickfireSurface
      props={{ ...baseProps, compose: { ...baseProps.compose!, ...compose } }}
      emitIntent={emitIntent}
    />,
  );
  return emitIntent;
}

describe("QuickfireSurface conversation", () => {
  it("offers expansion and restoration through the overlay window controls", () => {
    const toggle = vi.fn();
    const surface = <QuickfireSurface props={baseProps} emitIntent={vi.fn()} />;
    const { rerender } = render(
      <OverlayWindowContext.Provider value={{ expanded: false, toggle }}>
        {surface}
      </OverlayWindowContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Expand overlay" }));
    expect(toggle).toHaveBeenCalledOnce();
    rerender(
      <OverlayWindowContext.Provider value={{ expanded: true, toggle }}>
        {surface}
      </OverlayWindowContext.Provider>,
    );
    expect(
      screen.getByRole("button", { name: "Restore overlay size" }),
    ).toBeTruthy();
  });
  it("presents a notification-bound conversation as a reply surface", () => {
    renderSurface({ kind: "conversation", streaming: false });

    const input = screen.getByRole("textbox", {
      name: "Reply to this conversation",
    });
    expect(input.getAttribute("placeholder")).toBe("Reply…");
  });

  it("grows the composer with wrapped input while keeping it bounded by CSS", () => {
    const emitIntent = renderSurface({ streaming: false });
    const input = screen.getByRole("textbox") as HTMLTextAreaElement;
    Object.defineProperty(input, "scrollHeight", {
      configurable: true,
      value: 66,
    });

    fireEvent.change(input, {
      target: { value: "A prompt long enough to wrap over several lines" },
    });

    expect(input.tagName).toBe("TEXTAREA");
    expect(input.style.height).toBe("66px");
    expect(emitIntent).toHaveBeenCalledWith({
      type: "input",
      value: "A prompt long enough to wrap over several lines",
    });
  });

  it("keeps Shift+Enter available for multiline conversation input", () => {
    const emitIntent = renderSurface({ streaming: false });
    const input = screen.getByRole("textbox");

    const accepted = fireEvent.keyDown(input, { key: "Enter", shiftKey: true });

    expect(accepted).toBe(true);
    expect(emitIntent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "send" }),
    );
  });

  it("routes ordinary conversation prose as input without requiring a slash", () => {
    const emitIntent = renderSurface({ streaming: false });
    const input = screen.getByRole("textbox");

    fireEvent.change(input, {
      target: { value: "was that a model provider failure?" },
    });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(emitIntent).toHaveBeenNthCalledWith(1, {
      type: "input",
      value: "was that a model provider failure?",
    });
    expect(emitIntent).toHaveBeenNthCalledWith(2, {
      type: "send",
      text: "was that a model provider failure?",
    });
  });

  it("does not cycle out of a live conversation with the palette shortcut", () => {
    const emitIntent = renderSurface({ streaming: false });

    fireEvent.keyDown(screen.getByRole("textbox"), {
      key: "k",
      ctrlKey: true,
    });

    expect(emitIntent).not.toHaveBeenCalledWith({ type: "cycle-mode" });
  });

  it("emits clear on the first click without an armed confirmation state", () => {
    const emitIntent = renderSurface();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Clear this conversation and return to commands",
      }),
    );

    expect(emitIntent).toHaveBeenCalledWith({ type: "clear" });
  });

  it("renders the live phase, spinner, and each tool call's own state", () => {
    renderSurface({
      transcript: [
        {
          kind: "activity",
          id: "activity:turn-1",
          state: "working",
          phase: "using-tools",
          label: "using tools",
        },
        {
          kind: "tool",
          id: "tool:call-1",
          call: {
            id: "call-1",
            name: "panel_describe",
            state: "done",
            durationMs: 1_240,
          },
        },
        {
          kind: "tool",
          id: "tool:call-2",
          call: { id: "call-2", name: "panel_screenshot", state: "running" },
        },
      ],
    });

    expect(screen.getByText("Working")).toBeTruthy();
    expect(screen.getByText("using tools")).toBeTruthy();
    expect(screen.getByText("panel_describe")).toBeTruthy();
    // Duration and liveness distinguish the two calls; a name-only chip did not.
    expect(screen.getByText("1.2s")).toBeTruthy();
    expect(screen.getByText("running")).toBeTruthy();
    expect(document.querySelector(".qf-spinner")).not.toBeNull();
    const transcript = screen.getByTestId("quickfire-transcript");
    expect(transcript.hasAttribute("data-row")).toBe(false);
    expect(
      screen
        .getByText("panel_describe")
        .closest('.qf-box[data-surface="outline"]')
        ?.hasAttribute("data-fit"),
    ).toBe(true);
  });

  it("shows a spinner while the conversation itself is connecting", () => {
    renderSurface({ connecting: true, streaming: false });

    expect(screen.getByText(/Starting a conversation/u)).toBeTruthy();
    expect(document.querySelector(".qf-spinner")).not.toBeNull();
  });

  it("renders Markdown structure the old projection dropped", () => {
    renderSurface({
      transcript: [
        {
          kind: "message",
          id: "message-1",
          author: "agent",
          authorLabel: "agent",
          text: [
            "Found `channel-1` with **live state**.",
            "",
            "| Panel | State |",
            "| --- | --- |",
            "| Chat | open |",
            "",
            "- [x] checked the console",
            "- [ ] reproduced it",
          ].join("\n"),
        },
      ],
    });

    const answer = screen.getByTestId("quickfire-card-message-1");
    expect(answer.getAttribute("data-surface")).toBe("answer");
    expect(answer.getAttribute("data-tone")).toBe("accent");

    expect(screen.getByText("live state").tagName).toBe("SPAN");
    expect(screen.getByText("live state").dataset["variant"]).toBe("strong");
    expect(screen.getByText("channel-1").tagName).toBe("CODE");
    expect(screen.getByTestId("quickfire-table")).toBeTruthy();
    expect(screen.getByText("Chat")).toBeTruthy();
    expect(screen.getByText("☑")).toBeTruthy();
    expect(screen.getByText("☐")).toBeTruthy();
  });

  it("keeps intermediate agent narration visually subordinate to the answer", () => {
    renderSurface({
      transcript: [
        {
          kind: "message",
          id: "narration-1",
          author: "agent",
          authorLabel: "agent",
          tier: "secondary",
          text: "Checking the panel state.",
        },
      ],
    });

    const narration = screen.getByTestId("quickfire-card-narration-1");
    expect(narration.getAttribute("data-surface")).toBe("rail");
    expect(narration.getAttribute("data-tone")).toBe("neutral");
  });

  it("keeps collapsed reasoning compact alongside other activity", () => {
    renderSurface({
      transcript: [
        {
          kind: "thinking",
          id: "thought-1",
          text: "Inspecting the panel before proposing a repair with several implementation details.",
        },
      ],
    });

    const thought = screen.getByTestId("quickfire-card-thought-1");
    expect(thought.hasAttribute("data-full")).toBe(false);
    expect(
      screen.getByTestId("quickfire-transcript").hasAttribute("data-row"),
    ).toBe(false);
    expect(thought.hasAttribute("data-fit")).toBe(true);
  });

  it("keeps a failed turn's reason reachable instead of only colouring it", () => {
    renderSurface({
      transcript: [
        {
          kind: "message",
          id: "message-1",
          author: "agent",
          authorLabel: "agent",
          text: "",
          error: true,
          errorText: "provider returned 503",
        },
      ],
    });

    expect(screen.getByText("failed")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("What went wrong"));
    expect(screen.getByText("provider returned 503")).toBeTruthy();
  });

  it("expands a compact tool call into highlighted arguments and failure details", () => {
    renderSurface({
      transcript: [
        {
          kind: "tool",
          id: "tool:call-1",
          call: {
            id: "call-1",
            name: "panel_eval",
            state: "failed",
            arguments: [
              {
                name: "expression",
                value: "window.location.href",
                language: "javascript",
              },
            ],
            failure: "Panel was unavailable",
          },
        },
      ],
    });

    expect(
      screen
        .getByLabelText("panel_eval — failed")
        .getAttribute("aria-expanded"),
    ).toBe("false");
    fireEvent.click(screen.getByLabelText("panel_eval — failed"));
    const work = screen.getByTestId(
      "quickfire-detail-panel_eval — failed",
    ).parentElement;
    expect(work?.getAttribute("data-fit")).toBe("");
    const argument = document.querySelector(
      '.qf-code[data-language="javascript"]',
    );
    expect(argument).not.toBeNull();
    expect(argument?.querySelector('pre [class^="hljs-"]')).not.toBeNull();
    expect(screen.getAllByText("Panel was unavailable").length).toBeGreaterThan(
      0,
    );
  });

  it("announces a card it cannot run, and offers the surface that can", () => {
    const emitIntent = renderSurface({
      transcript: [
        {
          kind: "rich",
          id: "rich-1",
          title: "Card · chart",
          detail: "Q3 revenue",
        },
      ],
    });

    expect(screen.getByText("Card · chart")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Open it in the chat panel" }),
    );
    expect(emitIntent).toHaveBeenCalledWith({ type: "promote" });
  });

  it("offers to pull in trimmed entries rather than only counting them", () => {
    const emitIntent = renderSurface({
      olderCount: 12,
      expandable: true,
      transcript: [
        {
          kind: "message",
          id: "m",
          author: "you",
          authorLabel: "you",
          text: "hello",
        },
      ],
    });

    expect(screen.getByText("12 earlier entries")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Show earlier entries in this conversation",
      }),
    );
    expect(emitIntent).toHaveBeenCalledWith({ type: "show-older" });
  });

  it("keeps durable history paging available after the buffered entries are exhausted", () => {
    const emitIntent = renderSurface({
      olderCount: 0,
      expandable: true,
    });

    expect(screen.getByText("Load earlier history")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Show earlier entries in this conversation",
      }),
    );
    expect(emitIntent).toHaveBeenCalledWith({ type: "show-older" });
  });

  it("puts a stop control next to the input while a turn is in flight", () => {
    const emitIntent = renderSurface({ streaming: true });

    fireEvent.click(
      screen.getByRole("button", { name: "Stop the turn in flight" }),
    );
    expect(emitIntent).toHaveBeenCalledWith({ type: "stop" });
  });
});

describe("QuickfireSurface screenshots and actions", () => {
  const screenshotCall = {
    id: "call-1",
    name: "panel_screenshot",
    state: "done" as const,
    images: [
      {
        id: "call-1:0",
        mimeType: "image/png",
        width: 1280,
        height: 800,
        bytes: 402_931,
      },
    ],
  };

  it("offers a screenshot's bytes rather than shipping them on every push", () => {
    const emitIntent = renderSurface({
      transcript: [
        {
          kind: "tool",
          id: "tool:call-1",
          call: screenshotCall,
        },
      ],
    });

    fireEvent.click(screen.getByLabelText("panel_screenshot — done"));
    fireEvent.click(
      screen.getByRole("button", {
        name: "Show Image from panel_screenshot, 1280×800 · 393 KB",
      }),
    );
    expect(emitIntent).toHaveBeenCalledWith({
      type: "reveal-image",
      imageId: "call-1:0",
    });
  });

  it("draws the screenshot once the chrome has carried it over", () => {
    renderSurface({
      transcript: [
        {
          kind: "tool",
          id: "tool:call-1",
          call: {
            ...screenshotCall,
            images: [
              {
                ...screenshotCall.images[0]!,
                dataUrl: "data:image/png;base64,aGk=",
              },
            ],
          },
        },
      ],
    });

    fireEvent.click(screen.getByLabelText("panel_screenshot — done"));
    const image = screen.getByAltText("Image from panel_screenshot");
    expect(image.getAttribute("src")).toBe("data:image/png;base64,aGk=");
  });

  it("recalls your last message into an empty compose", () => {
    const emitIntent = renderSurface({
      transcript: [
        {
          kind: "message",
          id: "m1",
          author: "you",
          authorLabel: "you",
          text: "hello",
        },
      ],
    });

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "ArrowUp" });
    expect(emitIntent).toHaveBeenCalledWith({ type: "recall", delta: -1 });
  });

  it("leaves vertical caret navigation to a non-empty message composer", () => {
    const emitIntent = renderSurface();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, {
      target: { value: "A wrapped first line that continues\nsecond line" },
    });
    emitIntent.mockClear();

    const up = createEvent.keyDown(input, { key: "ArrowUp" });
    fireEvent(input, up);
    const down = createEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent(input, down);

    expect(up.defaultPrevented).toBe(false);
    expect(down.defaultPrevented).toBe(false);
    expect(emitIntent).not.toHaveBeenCalled();
  });

  it("lets you re-aim the overlay at another panel from the context strip", () => {
    const emitIntent = renderSurface();

    fireEvent.click(
      screen.getByRole("button", { name: "Choose which panel this acts on" }),
    );
    expect(emitIntent).toHaveBeenCalledWith({ type: "retarget" });
  });

  it("offers panel-aware openers on an empty conversation", () => {
    const emitIntent = renderSurface({
      transcript: [],
      suggestions: [
        {
          id: "explain",
          label: "What is this panel doing?",
          prompt: "Describe this panel.",
        },
      ],
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Describe this panel." }),
    );
    expect(emitIntent).toHaveBeenCalledWith({
      type: "send",
      text: "Describe this panel.",
    });
  });
});

describe("Quickfire redesigned controls", () => {
  it("sends a follow-up by button while retaining Stop and clears the local draft", () => {
    const emit = renderSurface({ streaming: true });
    const input = screen.getByRole("textbox");
    const send = screen.getByRole("button", { name: "Send message" });
    expect((send as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: "Focus on the first issue" } });
    expect(
      screen.getByRole("button", { name: "Stop the turn in flight" }),
    ).toBeTruthy();
    fireEvent.click(send);
    expect(emit).toHaveBeenCalledWith({
      type: "send",
      text: "Focus on the first issue",
    });
    expect((input as HTMLTextAreaElement).value).toBe("");
    expect((send as HTMLButtonElement).disabled).toBe(true);
  });
  it("does not send an IME composition on Enter", () => {
    const emit = renderSurface();
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "日本語" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "send" }),
    );
  });
  it("returns to commands without clearing the conversation", () => {
    const emit = renderSurface();
    fireEvent.click(screen.getByRole("button", { name: "‹ Commands" }));
    expect(emit).toHaveBeenCalledWith({ type: "mode", mode: "all" });
    expect(emit).not.toHaveBeenCalledWith({ type: "clear" });
  });
  it("links the palette input to its selected result for assistive technology", () => {
    render(
      <QuickfireSurface
        props={{
          ...baseProps,
          compose: null,
          mode: "all",
          groups: [
            {
              key: "commands",
              label: "Commands",
              rows: [
                {
                  id: "one",
                  title: "Open panel",
                  meta: "Choose a panel to open",
                },
              ],
            },
          ],
          selectedId: "one",
        }}
        emitIntent={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("combobox").getAttribute("aria-activedescendant"),
    ).toBe(screen.getByRole("option").id);
  });
});

it("searches models by provider and emits a model selection without sending a prompt", () => {
  const emit = renderSurface({
    modelSelection: {
      current: "one:fast",
      loading: false,
      saving: false,
      error: null,
      choices: [
        {
          ref: "one:fast",
          name: "Fast",
          provider: "First provider",
          available: true,
          detail: "Ready",
        },
        {
          ref: "two:deep",
          name: "Deep",
          provider: "Second provider",
          available: true,
          detail: "Ready",
        },
      ],
    },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Choose model and provider" }),
  );
  expect(emit).toHaveBeenCalledWith({ type: "load-models" });
  fireEvent.change(
    screen.getByRole("searchbox", { name: "Search models and providers" }),
    { target: { value: "second" } },
  );
  expect(
    screen.queryByRole("button", { name: "Use Fast from First provider" }),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Use Deep from Second provider" }),
  );
  expect(emit).toHaveBeenCalledWith({
    type: "select-model",
    model: "two:deep",
  });
  expect(emit).not.toHaveBeenCalledWith(
    expect.objectContaining({ type: "send" }),
  );
});

it("searches hidden tool payloads and keeps details open across streaming updates", () => {
  const props = {
    ...baseProps,
    compose: {
      ...baseProps.compose!,
      transcript: [
        {
          kind: "tool" as const,
          id: "tool:read",
          call: {
            id: "read",
            name: "read_file",
            state: "running" as const,
            arguments: [{ name: "path", value: "src/panel.ts" }],
            output: "Unique diagnostic",
          },
        },
      ],
    },
  };
  const { rerender } = render(
    <QuickfireSurface props={props} emitIntent={vi.fn()} />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Search conversation history" }),
  );
  fireEvent.change(
    screen.getByRole("searchbox", { name: "Search conversation history" }),
    { target: { value: "unique diagnostic" } },
  );
  expect(screen.getByText("read_file")).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "Expand all history details" }),
  );
  expect(
    screen.getByLabelText("read_file — running").getAttribute("aria-expanded"),
  ).toBe("true");
  rerender(
    <QuickfireSurface
      props={{
        ...props,
        compose: {
          ...props.compose,
          transcript: [
            {
              ...props.compose.transcript[0]!,
              call: {
                ...props.compose.transcript[0]!.call,
                output: "Unique diagnostic now complete",
                state: "done",
              },
            },
          ],
        },
      }}
      emitIntent={vi.fn()}
    />,
  );
  expect(
    screen.getByLabelText("read_file — done").getAttribute("aria-expanded"),
  ).toBe("true");
  fireEvent.click(
    screen.getByRole("button", { name: "Collapse all history details" }),
  );
  expect(
    screen.getByLabelText("read_file — done").getAttribute("aria-expanded"),
  ).toBe("false");
});

it("retains metadata on consecutive messages from the same agent", () => {
  renderSurface({
    transcript: [
      {
        kind: "message",
        id: "one",
        author: "agent",
        authorLabel: "Quickfire",
        text: "First reply",
        modelLabel: "Model A",
      },
      {
        kind: "message",
        id: "two",
        author: "agent",
        authorLabel: "Quickfire",
        text: "Second reply",
        modelLabel: "Model B",
      },
    ],
  });
  expect(screen.getByText("Model A")).toBeTruthy();
  expect(screen.getByText("Model B")).toBeTruthy();
});

it("does not claim a failed clipboard write succeeded", async () => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: vi.fn(async () => {
        throw new Error("denied");
      }),
    },
  });
  renderSurface({
    transcript: [
      {
        kind: "message",
        id: "copy",
        author: "agent",
        authorLabel: "Quickfire",
        text: "Copy this reply",
      },
    ],
  });
  fireEvent.click(screen.getByRole("button", { name: "Copy" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Copy failed, try again" }),
    ).toBeTruthy(),
  );
  expect(screen.queryByText("Copied")).toBeNull();
});

it("renders aligned table columns and keeps code scroll keys with the reader", () => {
  const emit = renderSurface({
    transcript: [
      {
        kind: "message",
        id: "data",
        author: "agent",
        authorLabel: "Quickfire",
        text: '| Item | Count |\n| :--- | ---: |\n| Widgets | 42 |\n\n```json\n{ "count": 42 }\n```',
      },
    ],
  });
  expect(screen.getByRole("table")).toBeTruthy();
  expect(
    screen.getByRole("columnheader", { name: "Count" }).style.textAlign,
  ).toBe("right");
  const code = screen.getByLabelText("json");
  fireEvent.keyDown(code, { key: "ArrowDown" });
  expect(emit).not.toHaveBeenCalledWith({ type: "move", delta: 1 });
  fireEvent.click(screen.getByRole("button", { name: "Wrap code lines" }));
  expect(
    screen
      .getByRole("button", { name: "Wrap code lines" })
      .getAttribute("aria-pressed"),
  ).toBe("false");
});
