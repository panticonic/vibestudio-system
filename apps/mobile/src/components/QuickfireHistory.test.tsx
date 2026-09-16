import { fireEvent, render } from "@testing-library/react-native";
import { createStore } from "jotai";
import {
  transcriptCards,
  type QuickfireTranscriptEntry,
} from "@workspace/quickfire-core";
import {
  QuickfireSkinProvider,
  Transcript,
} from "@workspace/quickfire-core/ui";
import { themeColorsAtom } from "../state/themeAtoms";
import { createNativeSkin } from "./overlay/nativeSkin";

const entries: QuickfireTranscriptEntry[] = [
  {
    kind: "message",
    id: "reply",
    author: "agent",
    authorLabel: "Quickfire",
    text: "The panel is ready.",
    modelLabel: "Provider / Model",
  },
  {
    kind: "tool",
    id: "tool:read",
    call: {
      id: "read",
      name: "read_file",
      state: "done",
      arguments: [{ name: "path", value: "src/panel.ts" }],
      output: "Unique output diagnostic",
      durationMs: 1200,
    },
  },
  {
    kind: "thinking",
    id: "thinking",
    text: "Inspect the layout.\nCheck the smallest viewport before changing it.",
  },
];
function renderHistory() {
  const skin = createNativeSkin(createStore().get(themeColorsAtom), {
    openLink: jest.fn(),
  });
  return render(
    <QuickfireSkinProvider value={skin}>
      <Transcript cards={transcriptCards(entries, { now: 0 })} />
    </QuickfireSkinProvider>,
  );
}
it("shows useful previews and expands every payload with shared history controls", () => {
  const { getByText, getByLabelText, queryByText } = renderHistory();
  expect(getByText("path: src/panel.ts")).toBeTruthy();
  expect(queryByText("Unique output diagnostic")).toBeNull();
  fireEvent.press(getByLabelText("Expand all history details"));
  expect(getByText("Unique output diagnostic")).toBeTruthy();
  expect(getByText("Model: Provider / Model")).toBeTruthy();
  fireEvent.press(getByLabelText("Collapse all history details"));
  expect(queryByText("Unique output diagnostic")).toBeNull();
});
it("finds text inside collapsed tool output and restores the unfiltered history", () => {
  const { getByLabelText, getByText, queryByText } = renderHistory();
  fireEvent.press(getByLabelText("Search conversation history"));
  fireEvent.changeText(
    getByLabelText("Search conversation history"),
    "unique output",
  );
  expect(getByText("read_file")).toBeTruthy();
  expect(queryByText("The panel is ready.")).toBeNull();
  fireEvent.press(getByLabelText("Expand all history details"));
  expect(getByText("Unique output diagnostic")).toBeTruthy();
  fireEvent.press(getByLabelText("Close history search"));
  expect(getByText("The panel is ready.")).toBeTruthy();
});
it("offers wrapping and expansion for the complete tool output", () => {
  const { getByLabelText, getAllByLabelText, getByText } = renderHistory();
  fireEvent.press(getByLabelText("Expand all history details"));
  const wrap = getAllByLabelText("Wrap code lines")[1]!;
  expect(wrap.props.accessibilityState.selected).toBe(true);
  fireEvent.press(wrap);
  expect(wrap.props.accessibilityState.selected).toBe(false);
  fireEvent.press(getAllByLabelText("Expand code block")[1]!);
  expect(getByLabelText("Collapse code block")).toBeTruthy();
  expect(getByText("Unique output diagnostic")).toBeTruthy();
});
