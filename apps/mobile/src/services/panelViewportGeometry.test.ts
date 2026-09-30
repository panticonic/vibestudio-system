import {
  panelViewportGeometry,
  panelViewportGeometryScript,
} from "./panelViewportGeometry";

const windowFrame = { x: 0, y: 0, width: 402, height: 874 };
const safe = { top: 62, left: 0, right: 0, bottom: 34 };

describe("panel viewport geometry", () => {
  it("excludes a native header but retains the home-indicator overlap", () => {
    expect(
      panelViewportGeometry(
        { x: 0, y: 110, width: 402, height: 764 },
        windowFrame,
        safe,
      ),
    ).toEqual({
      top: 0,
      left: 0,
      right: 0,
      bottom: 34,
      cornerRadiusHint: 48,
    });
  });

  it("does not inset the home indicator again when the keyboard has shortened the frame", () => {
    expect(
      panelViewportGeometry(
        { x: 0, y: 110, width: 402, height: 434 },
        windowFrame,
        safe,
      ).bottom,
    ).toBe(0);
  });

  it("measures landscape cutouts and already inset panel slots in window coordinates", () => {
    const window = { x: 12, y: 20, width: 874, height: 402 };
    const insets = { top: 0, left: 62, right: 62, bottom: 21 };
    expect(
      panelViewportGeometry(
        { x: 12, y: 70, width: 874, height: 352 },
        window,
        insets,
      ),
    ).toEqual({
      top: 0,
      left: 62,
      right: 62,
      bottom: 21,
      cornerRadiusHint: 48,
    });
    expect(
      panelViewportGeometry(
        { x: 74, y: 70, width: 750, height: 300 },
        window,
        insets,
      ),
    ).toEqual({
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      cornerRadiusHint: 48,
    });
  });

  it("publishes optional geometry without padding the document or rewriting unchanged properties", () => {
    const properties = new Map<string, string>();
    const setProperty = jest.fn((name: string, value: string) =>
      properties.set(name, value),
    );
    const document = {
      documentElement: {
        style: {
          getPropertyValue: (name: string) => properties.get(name) ?? "",
          setProperty,
        },
      },
    };
    const script = panelViewportGeometryScript(
      panelViewportGeometry(windowFrame, windowFrame, safe),
    );
    const apply = new Function("document", script);
    apply(document);
    apply(document);
    expect(setProperty).toHaveBeenCalledTimes(5);
    expect(properties.get("--vibestudio-safe-area-inset-bottom")).toBe("34px");
    expect(
      [...properties.keys()].every((name) => name.startsWith("--vibestudio-")),
    ).toBe(true);
  });
});
