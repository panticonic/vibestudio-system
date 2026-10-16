import { describe, expect, it } from "vitest";
import type { InstallReviewPart, InstallReviewRow } from "@vibestudio/shared/authority/unitInstallReview";
import {
  defaultInstallSelection,
  installAcceptanceFrom,
  installOfferSignature,
  selectedRowKeys,
  syncInstallSelection,
  type PendingUnitInstallReviewApproval,
} from "./installSelection.js";

function row(key: string, selectedByDefault = true): InstallReviewRow {
  return {
    key,
    kind: "permission",
    selectable: true,
    selectedByDefault,
    timing: "now",
  } as unknown as InstallReviewRow;
}

function part(identityKey: string, rows: InstallReviewRow[], change?: string): InstallReviewPart {
  return {
    identityKey,
    kind: "client",
    label: "Client",
    title: identityKey,
    change,
    notableRows: rows,
    everydayRows: [],
  } as unknown as InstallReviewPart;
}

const review = (parts: InstallReviewPart[], mode = "install"): PendingUnitInstallReviewApproval =>
  ({ kind: "unit-install-review", mode, parts }) as unknown as PendingUnitInstallReviewApproval;

describe("install selection", () => {
  const parts = [part("a", [row("a1"), row("a2", false)]), part("gone", [row("g1")], "removed")];

  it("defaults to what each offered row says, and omits parts being removed", () => {
    const selection = defaultInstallSelection(parts);
    expect([...selection.keys()]).toEqual(["a"]);
    expect([...selection.get("a")!]).toEqual(["a1"]);
    expect([...selectedRowKeys(parts[0]!, undefined)]).toEqual(["a1"]);
  });

  it("builds the acceptance the server expects, from the default or a controlled selection", () => {
    const approval = review(parts, "update");
    expect(installAcceptanceFrom(approval, undefined)).toEqual({
      decision: "update",
      allowNow: [{ identityKey: "a", permissions: ["a1"] }],
    });
    expect(installAcceptanceFrom(approval, new Map([["a", new Set<string>()]]))).toEqual({
      decision: "update",
      allowNow: [{ identityKey: "a", permissions: [] }],
    });
  });

  it("keeps a person's choices across a refresh, dropping rows no longer offered and leaving new ones unchecked", () => {
    const previous = new Map([["a", new Set(["a2", "stale"])]]);
    const refreshed = [part("a", [row("a1"), row("a2", false), row("a3")])];
    const next = syncInstallSelection(refreshed, previous);
    expect([...next.get("a")!]).toEqual(["a2"]);
  });

  it("changes the offer signature when what can be named changes", () => {
    const before = installOfferSignature([part("a", [row("a1")])]);
    expect(installOfferSignature([part("a", [row("a1")])])).toBe(before);
    expect(installOfferSignature([part("a", [row("a1"), row("a2")])])).not.toBe(before);
    expect(installOfferSignature([part("a", [row("a1", false)])])).not.toBe(before);
  });
});
