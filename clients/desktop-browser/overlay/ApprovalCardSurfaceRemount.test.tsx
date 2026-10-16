// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { Theme } from "@radix-ui/themes";
import { expect, it, vi } from "vitest";
import type { PendingClientConfigApproval } from "@vibestudio/shared/approvals";
import { ApprovalCardSurface } from "./ApprovalCardSurface";

function clientConfigApproval(
  partial: { approvalId: string; configId: string },
): PendingClientConfigApproval {
  return {
    kind: "client-config",
    callerId: `panel:${partial.approvalId}`,
    callerKind: "panel",
    repoPath: "panels/test",
    effectiveVersion: "ev",
    requestedAt: Date.now(),
    approvalId: partial.approvalId,
    configId: partial.configId,
    authorizeUrl: "https://accounts.example.test/oauth/authorize",
    tokenUrl: "https://accounts.example.test/oauth/token",
    title: partial.configId,
    fields: [
      { name: "clientSecret", label: "Client Secret", type: "secret", required: true },
    ],
  };
}

it("remounts the overlay card when the approval changes so secret inputs reset", () => {
    const first = clientConfigApproval({
      approvalId: "setup-a",
      configId: "service-a",
    });
    const second = clientConfigApproval({
      approvalId: "setup-b",
      configId: "service-b",
    });
    const emitIntent = vi.fn<(intent: unknown) => void>();
    const { rerender } = render(
      <Theme>
        <ApprovalCardSurface
          props={{ approval: first, queue: null, decisionError: null }}
          emitIntent={emitIntent}
        />
      </Theme>,
    );

    const firstInput = screen.getByPlaceholderText(
      "Client Secret",
    ) as HTMLInputElement;
    fireEvent.change(firstInput, { target: { value: "first-secret" } });
    expect(firstInput.value).toBe("first-secret");

    rerender(
      <Theme>
        <ApprovalCardSurface
          props={{ approval: second, queue: null, decisionError: null }}
          emitIntent={emitIntent}
        />
      </Theme>,
    );

    expect(
      (screen.getByPlaceholderText("Client Secret") as HTMLInputElement).value,
    ).toBe("");
  });
