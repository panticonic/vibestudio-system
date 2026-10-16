// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Theme } from "@radix-ui/themes";
import type { PendingApproval } from "@vibestudio/shared/approvals";
import type { ApprovalCardIntent } from "@workspace/client-kit-web";
import type { ChatSession } from "./session";

vi.mock("@workspace/approvals-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@workspace/approvals-core")>()),
  resolveCallerInfo: () => ({ label: "agent" }),
}));
vi.mock("@workspace/client-kit-web", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@workspace/client-kit-web")>()),
  ApprovalCard: (props: {
    approval: PendingApproval;
    queue: { index: number; total: number } | null;
    decisionError: string | null;
    actionPending: boolean;
    emit(intent: ApprovalCardIntent): void;
  }) => (
    <div data-testid="card">
      <span>{props.approval.approvalId}</span>
      <span>{props.queue ? `${props.queue.index + 1}/${props.queue.total}` : "single"}</span>
      {props.decisionError ? <span role="alert">{props.decisionError}</span> : null}
      {props.actionPending ? <span>pending</span> : null}
      <button onClick={() => props.emit({ approvalId: props.approval.approvalId, type: "decide", decision: "once" })}>
        allow
      </button>
      <button onClick={() => props.emit({ approvalId: props.approval.approvalId, type: "minimize" })}>
        minimize
      </button>
      <button onClick={() => props.emit({ approvalId: props.approval.approvalId, type: "browse", dir: "next" })}>
        next
      </button>
    </div>
  ),
}));

import { ApprovalDock } from "./ApprovalDock";

const approval = (approvalId: string, kind = "capability") =>
  ({ approvalId, kind }) as unknown as PendingApproval;

/** A queue the test can change, observed the way the real client observes the workspace. */
function fakeSession() {
  let publish: (pending: PendingApproval[]) => void = () => {};
  const resolve = vi.fn(async (_id: string, _decision: string) => {});
  const approvals = {
    resolve,
    observe(changed: (pending: PendingApproval[]) => void) {
      publish = changed;
      return {
        ready: Promise.resolve(),
        refresh: async () => {},
        stop: async () => {},
      };
    },
  };
  return {
    session: { approvals, workspaceId: "personal-ws" } as unknown as ChatSession,
    resolve,
    setPending: (pending: PendingApproval[]) => act(() => publish(pending)),
  };
}

function mount(session: ChatSession) {
  render(
    <Theme>
      <ApprovalDock session={session} appearance="light" />
    </Theme>
  );
}

/** Click and let the answer it starts settle inside act. */
async function click(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element);
  });
}

describe("ApprovalDock", () => {
  afterEach(cleanup);

  it("shows nothing until an approval is pending, then the card for it", async () => {
    const { session, setPending } = fakeSession();
    mount(session);
    expect(screen.queryByTestId("card")).toBeNull();
    setPending([approval("a1")]);
    expect(await screen.findByText("a1")).toBeTruthy();
  });

  it("records the person's decision on the workspace queue and keeps the card until the queue retires it", async () => {
    const { session, setPending, resolve } = fakeSession();
    mount(session);
    setPending([approval("a1")]);
    await click(await screen.findByText("allow"));
    expect(resolve).toHaveBeenCalledWith("a1", "once");
    expect(screen.getByTestId("card")).toBeTruthy();
    setPending([]);
    await waitFor(() => expect(screen.queryByTestId("card")).toBeNull());
  });

  it("browses the queue and never answers for a card that is not on screen", async () => {
    const { session, setPending, resolve } = fakeSession();
    mount(session);
    setPending([approval("a1"), approval("a2")]);
    expect(await screen.findByText("1/2")).toBeTruthy();
    fireEvent.click(screen.getByText("next"));
    expect(await screen.findByText("2/2")).toBeTruthy();
    await click(screen.getByText("allow"));
    expect(resolve).toHaveBeenCalledWith("a2", "once");
  });

  it("minimizes to a pill that brings the card back, and reopens for a new request", async () => {
    const { session, setPending } = fakeSession();
    mount(session);
    setPending([approval("a1")]);
    fireEvent.click(await screen.findByText("minimize"));
    expect(screen.queryByTestId("card")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Approvals waiting/ }));
    expect(screen.getByTestId("card")).toBeTruthy();
    fireEvent.click(screen.getByText("minimize"));
    setPending([approval("a1"), approval("a2")]);
    expect(await screen.findByTestId("card")).toBeTruthy();
  });

  it("says why an answer was not recorded while the request is still pending", async () => {
    const { session, setPending, resolve } = fakeSession();
    resolve.mockRejectedValueOnce(new Error("The server refused"));
    mount(session);
    setPending([approval("a1")]);
    await click(await screen.findByText("allow"));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "The server refused");
  });

  it("leaves a review that needs the browser to the browser, and says so", async () => {
    const { session, setPending } = fakeSession();
    mount(session);
    setPending([approval("r1", "unit-install-review")]);
    expect(await screen.findByText(/A review is waiting/)).toBeTruthy();
    expect(screen.queryByTestId("card")).toBeNull();
  });
});
