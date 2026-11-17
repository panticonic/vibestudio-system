import { describe, expect, it } from "vitest";
import { historyProofNotice } from "./historyProofNotice";

describe("historyProofNotice", () => {
  it("says nothing while the newest entry is proven or unproven", () => {
    expect(historyProofNotice([])).toBeNull();
    expect(
      historyProofNotice([
        { state: "proven", failure: null },
        { state: "failed", failure: null },
      ]),
    ).toBeNull();
    expect(
      historyProofNotice([{ state: "unproven", failure: null }]),
    ).toBeNull();
  });

  it("reports going back when an older entry is proven", () => {
    expect(
      historyProofNotice([
        {
          state: "failed",
          failure: { code: "boot-error", message: "x is undefined" },
        },
        { state: "proven", failure: null },
      ]),
    ).toEqual({
      title:
        "The latest update failed to start; showing the last working version",
      detail: "x is undefined",
    });
  });

  it("reports a failure with nothing to go back to", () => {
    expect(
      historyProofNotice([
        { state: "failed", failure: { code: "build-error" } },
      ]),
    ).toEqual({ title: "This page failed to start", detail: "build-error" });
  });
});
