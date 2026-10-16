import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { createWorkspaceModel, type WorkspacePort } from "@workspace/workspace-core";
import { KitTestProvider } from "../testing/KitTestProvider";
import { WorkspaceList } from "./WorkspaceList";

const workspaces = [
  { id: "ws-a", name: "Alpha" },
  { id: "ws-b", name: "Beta" },
];

function setup(port: Partial<WorkspacePort> = {}, currentId = "ws-a") {
  const model = createWorkspaceModel(
    {
      list: async () => workspaces,
      select: jest.fn(async () => undefined),
      ...port,
    },
    currentId,
  );
  const onSwitched = jest.fn();
  const onError = jest.fn();
  const view = render(
    <WorkspaceList model={model} onSwitched={onSwitched} onError={onError} />,
    { wrapper: KitTestProvider },
  );
  return { model, onSwitched, onError, ...view };
}

describe("WorkspaceList", () => {
  it("says it is loading, then lists the workspaces as the host does with the current one marked", async () => {
    const { model, getByText, getAllByRole } = setup({}, "ws-b");
    expect(getByText("Loading workspaces…")).toBeTruthy();
    await act(async () => {
      await model.load();
    });
    const rows = getAllByRole("button");
    expect(rows.map((row) => row.props.accessibilityLabel)).toEqual(["Open Alpha", "Open Beta"]);
    expect(rows[1]?.props.accessibilityState).toEqual({ selected: true });
    expect(getByText("Current")).toBeTruthy();
  });

  it("filters by what the person types", async () => {
    const { model, getByLabelText, queryByText } = setup();
    await act(async () => {
      await model.load();
    });
    fireEvent.changeText(getByLabelText("Filter workspaces"), "bet");
    expect(queryByText("Alpha")).toBeNull();
    expect(queryByText("Beta")).toBeTruthy();
  });

  it("switches through the host and reports it", async () => {
    const select = jest.fn(async () => undefined);
    const { model, onSwitched, getByTestId } = setup({ select });
    await act(async () => {
      await model.load();
    });
    fireEvent.press(getByTestId("workspace-entry-ws-b"));
    await waitFor(() => expect(onSwitched).toHaveBeenCalledWith("ws-b"));
    expect(select).toHaveBeenCalledWith("ws-b");
  });

  it("reports a failed switch and stays on the current workspace", async () => {
    const select = jest.fn(async () => {
      throw new Error("refused");
    });
    const { model, onError, onSwitched, getByTestId } = setup({ select });
    await act(async () => {
      await model.load();
    });
    fireEvent.press(getByTestId("workspace-entry-ws-b"));
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onSwitched).not.toHaveBeenCalled();
    expect(model.getSnapshot().currentId).toBe("ws-a");
  });

  it("shows the failure where the list would be", async () => {
    const { model, getByText } = setup({
      list: async () => {
        throw new Error("offline");
      },
    });
    await act(async () => {
      await model.load().catch(() => undefined);
    });
    expect(getByText("Could not list workspaces: offline")).toBeTruthy();
  });
});
