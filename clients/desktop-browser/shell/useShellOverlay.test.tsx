// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { StrictMode } from "react";
import { createPortal } from "react-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("./client", () => ({}));

import { useShellOverlay } from "./useShellOverlay";
import {
  ShellPresentationStoreContext,
  WorkspaceVisibilityContext,
} from "./workspaceContext";
import {
  shellOverlayActiveAtom,
  shellOverlayOwnersAtom,
} from "../state/appModeAtoms";

function Review() {
  useShellOverlay(true);
  return <div role="dialog">Review</div>;
}

describe("shell dialog ownership", () => {
  it("keeps the window covered through a review handoff between workspace stores", () => {
    const windowStore = createStore();
    const personalStore = createStore();
    const systemStore = createStore();
    function Window({
      personal,
      system,
    }: {
      personal: boolean;
      system: boolean;
    }) {
      return (
        <StrictMode>
          <Provider store={windowStore}>
            <ShellPresentationStoreContext.Provider value={windowStore}>
              {[
                { store: personalStore, open: personal },
                { store: systemStore, open: system },
              ].map(({ store, open }, index) => (
                <Provider key={index} store={store}>
                  <WorkspaceVisibilityContext.Provider value={false}>
                    {open &&
                      createPortal(
                        <WorkspaceVisibilityContext.Provider value={true}>
                          <Review />
                        </WorkspaceVisibilityContext.Provider>,
                        document.body,
                      )}
                  </WorkspaceVisibilityContext.Provider>
                </Provider>
              ))}
            </ShellPresentationStoreContext.Provider>
          </Provider>
        </StrictMode>
      );
    }
    const rendered = render(<Window personal={false} system />);
    expect(windowStore.get(shellOverlayActiveAtom)).toBe(true);
    rendered.rerender(<Window personal system={false} />);
    expect(windowStore.get(shellOverlayActiveAtom)).toBe(true);
    expect(windowStore.get(shellOverlayOwnersAtom).size).toBe(1);
    expect(personalStore.get(shellOverlayActiveAtom)).toBe(false);
    expect(systemStore.get(shellOverlayActiveAtom)).toBe(false);
    rendered.rerender(<Window personal system />);
    expect(windowStore.get(shellOverlayOwnersAtom).size).toBe(2);
    rendered.rerender(<Window personal system={false} />);
    expect(windowStore.get(shellOverlayActiveAtom)).toBe(true);
    rendered.unmount();
    expect(windowStore.get(shellOverlayActiveAtom)).toBe(false);
  });
});
