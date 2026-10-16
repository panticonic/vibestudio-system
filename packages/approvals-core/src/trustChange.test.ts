import { describe, expect, it } from "vitest";
import type { ClientTrustChange, PendingApproval } from "@vibestudio/shared/approvals";
import { hasTrustChange, TRUST_CHANGE_COPY, trustChangeSection } from "./trustChange.js";

const base = {
  approvalId: "t1",
  callerId: "agent:1",
  callerKind: "do" as const,
  repoPath: "meta",
  effectiveVersion: "ev",
  requestedAt: 1,
};

const capability = (trustChange?: ClientTrustChange[]): PendingApproval => ({
  ...base,
  kind: "capability",
  capability: "workspace.publish",
  title: "Change which apps may act on this device",
  cardType: "confirm.critical",
  ...(trustChange ? { trustChange } : {}),
});

const chat: ClientTrustChange = {
  source: "clients/chat-desktop",
  title: "Chat Desktop",
  icon: "💬",
  runtime: "web",
  gained: [
    { capability: "approval-surface", summary: "Show and answer approvals on your behalf" },
    { capability: "device-session", summary: "Act as this device in every workspace" },
  ],
  lost: [],
  effectiveVersion: "9f2c1ab",
};

describe("trust change card model", () => {
  it("is absent for an approval that changes no client's power", () => {
    expect(trustChangeSection(capability())).toBeNull();
    expect(trustChangeSection(capability([]))).toBeNull();
    expect(hasTrustChange(capability())).toBe(false);
  });

  it("names each client with its runtime, icon, plain-language powers and pinned version", () => {
    const section = trustChangeSection(capability([chat]));
    expect(section).not.toBeNull();
    expect(section?.heading).toBe(TRUST_CHANGE_COPY.heading);
    expect(section?.summary).toBe("This changes what one app may do on this device.");
    expect(section?.entries).toHaveLength(1);
    expect(section?.entries[0]).toMatchObject({
      source: "clients/chat-desktop",
      name: "Chat Desktop",
      icon: "💬",
      runtime: "web",
      runtimeLabel: "Desktop app",
      headline: "Chat Desktop (Desktop app) gains device-level access",
      pinnedLine: "Pinned to 9f2c1ab",
      version: "9f2c1ab",
    });
    expect(section?.entries[0]?.gained.map((power) => power.summary)).toEqual([
      "Show and answer approvals on your behalf",
      "Act as this device in every workspace",
    ]);
    expect(section?.entries[0]?.lost).toEqual([]);
  });

  it("describes losses, mixed changes, other runtimes and an unknown version honestly", () => {
    const section = trustChangeSection(
      capability([
        {
          source: "clients/chat-mobile",
          title: "Chat Mobile",
          runtime: "react-native",
          gained: [],
          lost: [{ capability: "notifications", summary: "Show notifications" }],
          effectiveVersion: null,
        },
        {
          source: "clients/chat-terminal",
          title: "Chat Terminal",
          runtime: "terminal",
          gained: [{ capability: "approval-surface", summary: "Answer approvals" }],
          lost: [{ capability: "open-external", summary: "Open links" }],
          effectiveVersion: "v2",
        },
      ])
    );
    expect(section?.summary).toBe("This changes what 2 apps may do on this device.");
    expect(section?.entries.map((entry) => entry.headline)).toEqual([
      "Chat Mobile (Mobile app) loses device-level access",
      "Chat Terminal (Terminal app) changes its device-level access",
    ]);
    expect(section?.entries[0]?.pinnedLine).toBe(TRUST_CHANGE_COPY.pinnedUnknown);
    expect(section?.entries[0]?.icon).toBeUndefined();
  });

  it("states that the decision is one-time", () => {
    expect(trustChangeSection(capability([chat]))?.decisionNote).toContain("one time");
  });
});
