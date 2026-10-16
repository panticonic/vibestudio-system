import { describe, expect, it, vi } from "vitest";

vi.mock("../workspaceContext", () => ({}));

import { currentAccountProfileFailure } from "./useAccountProfiles";

describe("currentAccountProfileFailure", () => {
  const previous = {
    profile: null,
    settled: false,
    error: null,
  };

  it("leaves a global transport outage to the desktop connection surface", () => {
    const failure = Object.assign(new Error("server unavailable"), {
      code: "CONNECTION_LOST",
    });

    expect(currentAccountProfileFailure(previous, failure)).toEqual({
      profile: null,
      settled: true,
      error: null,
    });
  });

  it("still reports an actual account identity failure", () => {
    expect(
      currentAccountProfileFailure(previous, new Error("identity is invalid")),
    ).toEqual({
      profile: null,
      settled: true,
      error: "identity is invalid",
    });
  });
});
