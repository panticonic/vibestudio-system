import { describe, expect, it } from "vitest";
import compare from "../system-investigation/investigateSystem/comparePerformance/compare.js";
import { verifySystemInvestigation } from "./oracle.js";
import { systemInvestigationWorlds } from "./worlds.js";

describe("authored system-investigation worlds", () => {
  it("covers the five investigation kinds with distinct goals and private contracts", () => {
    expect(
      new Set(systemInvestigationWorlds.map((world) => world.id)).size,
    ).toBe(systemInvestigationWorlds.length);
    expect(
      new Set(systemInvestigationWorlds.map((world) => world.request.goal))
        .size,
    ).toBe(systemInvestigationWorlds.length);
    expect(
      new Set(systemInvestigationWorlds.map((world) => world.request.kind))
        .size,
    ).toBe(5);
    for (const world of systemInvestigationWorlds) {
      expect(world.sourceGroup).toContain(`:${world.request.kind}:`);
      expect(world.request).not.toHaveProperty("expected");
      expect(world.request).not.toHaveProperty("evidence");
    }
  });

  it.each(systemInvestigationWorlds)(
    "qualifies the reference, evidence mutation, and missing result for $id",
    (world) => {
      expect(
        verifySystemInvestigation(world, structuredClone(world.expected))
          .passed,
      ).toBe(true);
      expect(
        verifySystemInvestigation(world, {
          status: world.expected.status,
          findings: [],
        }).passed,
      ).toBe(false);
      const falseCitation = structuredClone(world.expected);
      falseCitation.findings[0]!.evidenceIds = ["receipt-from-another-run"];
      expect(verifySystemInvestigation(world, falseCitation).passed).toBe(
        false,
      );
      const impossibleStatus =
        world.expected.status === "ready" ? "blocked" : "ready";
      expect(
        verifySystemInvestigation(world, {
          ...world.expected,
          status: impossibleStatus,
        }).passed,
      ).toBe(false);
    },
  );

  it("qualifies exact performance calculations and stays invariant under aliases", () => {
    for (const world of systemInvestigationWorlds) {
      if (world.request.kind !== "performance") continue;
      const verdict = compare(world.request).verdict;
      expect(verdict).toBe(world.expected.findings[0]!.code);
      const alias = structuredClone(world.request);
      alias.baseline.id = "alias-a";
      alias.candidate.id = "alias-b";
      alias.goal = "The identifiers were changed for this repeat.";
      expect(compare(alias)).toEqual(compare(world.request));
      expect(
        verifySystemInvestigation(world, {
          status: world.expected.status,
          findings: [{ code: verdict, evidenceIds: ["alias-a", "alias-b"] }],
        }).passed,
      ).toBe(false);
    }
  });
});
