import { describe, expect, it } from "vitest";
import assemble from "./briefServerLog/assemble.js";
import condense from "./briefServerLog/condense.js";
import type { LogClass, LogRecord, LogSnapshot } from "./types.js";

const line = (
  seq: number,
  message: string,
  level: LogRecord["level"] = "info",
  tag = "ServiceContainer"
): LogRecord => ({
  seq,
  timestamp: 1_793_119_500_000 + seq,
  level,
  tag,
  message,
  pid: 4242,
});

describe("condense", () => {
  it("collapses lines that differ only in names, numbers and identifiers, and counts them exactly", () => {
    const groups = condense([
      line(8, "[nativeWorkspace] Starting"),
      line(9, "[tokenManager] Starting"),
      line(10, "Gateway listening on 127.0.0.1:43289", "info", "Gateway"),
      line(11, "[auth] Starting"),
      line(12, "-> GET /_a/84de93112a34/chunk-TEJVFBI4.js", "info", "gateway.fetch"),
      line(13, "-> GET /_a/84de93112a34/chunk-JRHAGRTR.js", "info", "gateway.fetch"),
    ]);
    expect(
      groups.map((group) => [group.message, group.count, group.firstSeq, group.lastSeq])
    ).toEqual([
      ["[nativeWorkspace] Starting", 3, 8, 11],
      ["Gateway listening on 127.0.0.1:43289", 1, 10, 10],
      ["-> GET /_a/84de93112a34/chunk-TEJVFBI4.js", 2, 12, 13],
    ]);
  });

  it("keeps different levels and tags apart", () => {
    const groups = condense([
      line(1, "slow", "warn", "DODispatch"),
      line(2, "slow", "info", "DODispatch"),
      line(3, "slow", "warn", "Gateway"),
    ]);
    expect(groups).toHaveLength(3);
  });

  it("cuts a long first message", () => {
    expect(condense([line(1, "x".repeat(500))])[0]?.message).toHaveLength(300);
  });
});

describe("assemble", () => {
  const snapshot: LogSnapshot = {
    serverBootId: "boot-1793119501-385223",
    latestSeq: 1022,
    totalCaptured: 1019,
    records: [line(60, "a"), line(70, "b"), line(80, "c")],
  };
  const groups = condense(
    snapshot.records.map((record, index) =>
      line(record.seq, ["a", "b", "c"][index] ?? "", index === 1 ? "error" : "info", `Tag${index}`)
    )
  );

  it("copies the identity and the window from the data, and orders failures first", () => {
    const classes: LogClass[] = ["notable", "failure", "routine"];
    const brief = assemble(snapshot, groups, classes);
    expect(brief.serverBootId).toBe("boot-1793119501-385223");
    expect(brief.latestSeq).toBe(1022);
    expect(brief.window).toEqual({ fromSeq: 60, toSeq: 80, records: 3 });
    expect(brief.status).toBe("incident");
    expect(brief.headline).toBe("1 failure and 1 notable group in 3 lines of the host log.");
    expect(brief.findings.map((finding) => [finding.class, finding.firstSeq])).toEqual([
      ["failure", 70],
      ["notable", 60],
    ]);
  });

  it("is normal only when every group is routine, attention when something is notable", () => {
    expect(assemble(snapshot, groups, ["routine", "routine", "routine"]).status).toBe("normal");
    expect(assemble(snapshot, groups, ["routine", "notable", "routine"]).status).toBe("attention");
  });

  it("refuses a class list that does not match the groups", () => {
    expect(() => assemble(snapshot, groups, ["routine"])).toThrow(/one class per group/);
  });

  it("describes an empty read by the latest seq", () => {
    const brief = assemble({ ...snapshot, records: [] }, [], []);
    expect(brief.window).toEqual({ fromSeq: 1022, toSeq: 1022, records: 0 });
  });
});

describe("a line without a tag", () => {
  it("leaves the tag out of its group and its finding, so the brief is plain JSON", () => {
    const untagged: LogRecord = {
      seq: 5,
      timestamp: 1,
      level: "warn",
      message: "(node:1) DeprecationWarning: x",
      pid: 1,
    };
    const groups = condense([untagged]);
    expect("tag" in (groups[0] ?? {})).toBe(false);
    const brief = assemble(
      { serverBootId: "b", latestSeq: 5, totalCaptured: 1, records: [untagged] },
      groups,
      ["notable"]
    );
    expect(JSON.parse(JSON.stringify(brief))).toEqual(brief);
  });
});
