// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Theme } from "@radix-ui/themes";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PendingDeviceCodeApproval } from "@vibestudio/shared/approvals";
import { DeviceCodeActions, DeviceCodeBody } from "./SignIn";

const approval: PendingDeviceCodeApproval = {
  kind: "device-code",
  approvalId: "device-1",
  callerId: "panel:chat",
  callerKind: "panel",
  repoPath: "panels/chat",
  effectiveVersion: "ev",
  requestedAt: 1,
  title: "Sign in",
  credentialLabel: "GitHub",
  userCode: "ABCD-1234",
  verificationUri: "https://github.com/login/device",
  oauthTokenOrigin: "https://github.com",
  expiresAt: 10_000,
} as PendingDeviceCodeApproval;

afterEach(cleanup);

describe("device-code sign-in", () => {
  it("shows the code and where to type it, in the host's words", () => {
    render(
      <Theme>
        <DeviceCodeBody approval={approval} />
      </Theme>,
    );
    expect(screen.getByText("ABCD-1234")).toBeTruthy();
    expect(screen.getByText("https://github.com")).toBeTruthy();
  });

  it("offers one way out: cancel", () => {
    const onCancel = vi.fn();
    render(
      <Theme>
        <DeviceCodeActions onCancel={onCancel} />
      </Theme>,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
