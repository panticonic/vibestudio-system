import { PanelSelectionState } from "./panelSelection";

describe("panel selection state", () => {
  it("replays an exact selection made before the first subscriber mounts", () => {
    const selections = new PanelSelectionState();
    const restored = selections.select("panel:tree/restored");
    const listener = jest.fn();

    const unsubscribe = selections.subscribe(listener);

    expect(listener).toHaveBeenCalledWith(restored);
    expect(restored).toEqual({
      panelId: "panel:tree/restored",
      revision: 1,
    });
    selections.select("panel:tree/newer");
    expect(listener).toHaveBeenLastCalledWith({
      panelId: "panel:tree/newer",
      revision: 2,
    });
    unsubscribe();
  });
});
