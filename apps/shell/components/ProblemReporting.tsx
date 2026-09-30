import { problemReportingConversation } from "@vibestudio/shared/problemReportingConversation";
import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Button, Checkbox, Dialog, Flex, Text } from "@radix-ui/themes";
import { useShellOverlay } from "../shell/useShellOverlay";
import { useShellWorkspaceClient } from "../shell/workspaceContext";
import { useShellEvent } from "../shell/useShellEvent";
import { reportDraftContent } from "@vibestudio/service-schemas/problemReportBundle";

const COPY =
  "Share automatic error reports and anonymous usage statistics to help improve Vibestudio. Reports use a random device identifier; chat, code, and screenshots are excluded, and you can turn sharing off anytime.";
const ReportingReadyContext = createContext(true);
export const useReportingReady = () => useContext(ReportingReadyContext);

/** One consent model drives first-start presentation and workspace audit defaults. */
export function useReportingSetup(
  problemReports: ReturnType<typeof useShellWorkspaceClient>["problemReports"],
  active: boolean,
  pending = false,
  reviewKey = "first-start",
) {
  type Decision = Awaited<ReturnType<typeof problemReports.consent>>;
  const [decisions, setDecisions] = useState<{
    device: Decision;
    server: Decision | null | undefined;
  } | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [enabled, setEnabled] = useState<boolean | "indeterminate">(false);
  const dirty = useRef(false);
  const generation = useRef(0);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    const request = ++generation.current;
    const [device, server] = await Promise.allSettled([
      problemReports.consent(),
      problemReports.serverConsent(),
    ]);
    if (generation.current !== request) return;
    if (device.status === "rejected") {
      setDecisions(null);
      setError(String(device.reason));
      return;
    }
    const remote = server.status === "fulfilled" ? server.value : undefined;
    setDecisions({ device: device.value, server: remote });
    setLoadedFor(reviewKey);
    setError(
      server.status === "rejected"
        ? `Reporting preference unavailable: ${String(server.reason)}`
        : "",
    );
    if (!dirty.current) {
      const known = [device.value, remote].filter(
        (choice) => choice && choice.state !== "undecided",
      );
      const states = new Set(known.map((choice) => choice!.state));
      setEnabled(states.size > 1 ? "indeterminate" : states.has("on"));
    }
  }, [problemReports, reviewKey]);
  useEffect(() => {
    setDecisions(null);
    setLoadedFor(null);
    dirty.current = false;
    setEnabled(false);
    setError("");
    if (active) void reload();
    return () => {
      generation.current++;
    };
  }, [active, reload]);
  useShellEvent("server-connection-changed", ({ status }) => {
    if (active && !pending && status === "connected") void reload();
  });
  const ready = !!decisions && loadedFor === reviewKey;
  const firstUse =
    decisions?.device.state === "undecided" &&
    (!decisions.server || decisions.server.state === "undecided");
  const required =
    active &&
    (!ready ||
      decisions.device.state === "undecided" ||
      decisions.server?.state === "undecided" ||
      dirty.current);
  const save = async (initialChoice?: "on" | "off") => {
    if (!decisions || !ready)
      throw new Error("Load the reporting choice before accepting.");
    const state = initialChoice ?? (enabled === true ? "on" : "off");
    try {
      if (
        decisions.device.state === "undecided" ||
        ((initialChoice !== undefined || dirty.current) &&
          decisions.device.state !== state)
      ) {
        const device = await problemReports.decide(
          decisions.device.revision,
          state,
        );
        setDecisions((current) => current && { ...current, device });
      }
      if (
        decisions.server &&
        (decisions.server.state === "undecided" ||
          ((initialChoice !== undefined || dirty.current) &&
            decisions.server.state !== state))
      ) {
        const server = await problemReports.decideServer(
          decisions.server.revision,
          state,
        );
        setDecisions((current) => current && { ...current, server });
      }
      if (
        initialChoice !== undefined ||
        dirty.current ||
        enabled !== "indeterminate"
      )
        setEnabled(state === "on");
      dirty.current = false;
    } catch (cause) {
      await reload();
      throw cause;
    }
  };
  const status = (
    <>
      {!decisions && !error && (
        <Text role="status">Loading sharing choice…</Text>
      )}
      {error && (
        <>
          <Text role="alert">{error}</Text>
          <Button
            variant="outline"
            disabled={pending}
            onClick={() => void reload()}
          >
            Retry sharing choice
          </Button>
        </>
      )}
    </>
  );
  const content = !active ? null : (
    <section aria-label="Improvement reporting" style={{ padding: "12px 0" }}>
      <Text as="label" size="2">
        <Flex gap="2" align="center">
          <Checkbox
            checked={enabled}
            disabled={!ready || pending}
            onCheckedChange={(value) => {
              dirty.current = true;
              setEnabled(value);
            }}
          />
          Help Vibestudio improve by sharing automatic error reports and usage
          counters
        </Flex>
      </Text>
      <Text as="p" size="1" color="gray">
        Your previous choice is selected. You can change it here or in Settings.
      </Text>
      {status}
    </section>
  );
  return {
    required,
    save,
    content,
    ready,
    firstUse,
    status,
    enabled,
  };
}

/** The only separate reporting prompt; audit presentation waits for this decision. */
export function ReportingFirstUse({ children }: { children: ReactNode }) {
  const { problemReports } = useShellWorkspaceClient();
  const setup = useReportingSetup(problemReports, true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [manualChoice, setManualChoice] = useState<"on" | "off" | null>(null);
  const open = !!setup.firstUse || manualChoice !== null;
  useEffect(() => {
    if (
      !setup.ready ||
      !setup.required ||
      setup.firstUse ||
      busy ||
      error ||
      manualChoice !== null
    )
      return;
    setBusy(true);
    void setup
      .save()
      .catch((cause) => setError(String(cause)))
      .finally(() => setBusy(false));
  }, [setup.ready, setup.required, setup.firstUse, busy, error, manualChoice]);
  useShellOverlay(open);
  const choose = async (state: "on" | "off") => {
    setManualChoice(state);
    setBusy(true);
    setError("");
    try {
      await setup.save(state);
      setManualChoice(null);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ReportingReadyContext.Provider
      value={setup.ready && !setup.required && !open && !busy && !error}
    >
      {!setup.ready && (
        <div data-shell-top-chrome="reporting-choice-status">
          {setup.status}
        </div>
      )}
      {!open && error && (
        <div data-shell-top-chrome="reporting-choice-status">
          <Text role="alert">Could not save reporting preference.</Text>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setError("")}
          >
            Retry
          </Button>
        </div>
      )}
      <Dialog.Root open={open}>
        <Dialog.Content
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <Dialog.Title>Help Vibestudio improve</Dialog.Title>
          <Dialog.Description>{COPY}</Dialog.Description>
          {setup.status}
          <Flex gap="3" mt="4">
            <Button
              variant="outline"
              disabled={busy || !setup.ready}
              onClick={() => void choose("on")}
            >
              Enable automatic reports
            </Button>
            <Button
              variant="outline"
              disabled={busy || !setup.ready}
              onClick={() => void choose("off")}
            >
              Keep automatic reports off
            </Button>
          </Flex>
          {error && (
            <Text role="alert">Could not save sharing choice: {error}</Text>
          )}
        </Dialog.Content>
      </Dialog.Root>
      {children}
    </ReportingReadyContext.Provider>
  );
}

export function ProblemReportingSection() {
  const { problemReports, app } = useShellWorkspaceClient();
  const discuss = (context?: { reportId: string; revision: number }) =>
    app.openShellSurface({
      kind: "command-agent",
      prompt: problemReportingConversation(context),
    });
  const [incidents, setIncidents] = useState<Record<string, unknown>[]>([]);
  const [history, setHistory] = useState<
    Awaited<ReturnType<typeof problemReports.history>>
  >([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [discardReport, setDiscardReport] = useState<string | null>(null);
  const [discardAcknowledged, setDiscardAcknowledged] = useState(false);
  const setup = useReportingSetup(problemReports, true, busy);
  const refresh = useCallback(async () => {
    const [rows, observations] = await Promise.all([
      problemReports.history(),
      problemReports.incidents(),
    ]);
    setHistory(rows);
    setIncidents(observations);
  }, [problemReports]);
  useEffect(() => {
    void refresh().catch((error) => setError(String(error)));
  }, [refresh]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Flex direction="column" gap="3">
      <Text size="5" weight="bold">
        Problem reporting
      </Text>
      <Text>{COPY}</Text>
      <Text as="label" size="2">
        <Flex gap="2" align="center">
          <Checkbox
            checked={setup.enabled}
            disabled={busy || !setup.ready}
            onCheckedChange={(value) =>
              void run(() => setup.save(value === true ? "on" : "off"))
            }
          />
          Share improvement information
        </Flex>
      </Text>
      {setup.status}
      <Button
        disabled={busy}
        onClick={() =>
          void run(async () => {
            await discuss();
          })
        }
      >
        Report a problem
      </Button>
      <Text size="4" weight="bold">
        Local incidents
      </Text>
      {incidents.map((incident) => (
        <Flex key={String(incident["id"])} gap="2" wrap="wrap">
          <Text>
            {String(incident["last_at"])} · {String(incident["count"])}{" "}
            observations · {String(incident["value"])}
          </Text>
          <Button
            size="1"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const draft = await problemReports.create(
                  JSON.parse(String(incident["value"])),
                );
                const updated = await problemReports.update(
                  draft.id,
                  draft.revision,
                  reportDraftContent({
                    ...draft.value,
                    evidence: [
                      {
                        id: crypto.randomUUID(),
                        source: "failure",
                        coordinate: String(incident["id"]),
                        capturedAt: new Date().toISOString(),
                        completeness: "complete",
                        reason: null,
                        retained: Number(incident["count"]),
                        omitted: 0,
                        redactions: [],
                        value: JSON.stringify(incident),
                      },
                    ],
                  }),
                );
                await discuss(
                  await problemReports.forConversation(
                    draft.id,
                    updated.revision,
                  ),
                );
              })
            }
          >
            Report this problem
          </Button>
        </Flex>
      ))}
      <Text size="4" weight="bold">
        Report history
      </Text>
      <Button
        variant="outline"
        disabled={busy}
        onClick={() => void run(refresh)}
      >
        Refresh history
      </Button>
      {history.map((row, index) => (
        <Flex key={`${row["id"]}-${index}`} gap="2" wrap="wrap">
          <Text>
            {String(row["updated_at"])} · {String(row["state"] ?? "draft")}{" "}
            {String(row["reason"] ?? "")}
          </Text>
          <Button
            size="1"
            onClick={() =>
              void run(async () => {
                const draft = await problemReports.get(String(row["id"]));
                await discuss(
                  await problemReports.forConversation(
                    draft.id,
                    draft.revision,
                  ),
                );
              })
            }
          >
            Discuss report
          </Button>
          <Button
            size="1"
            variant="outline"
            onClick={() =>
              void run(async () => {
                await problemReports.cancel(String(row["id"]));
              })
            }
          >
            Cancel queued delivery
          </Button>
          {Boolean(row["submissionId"]) && (
            <>
              <Button
                size="1"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await problemReports.remoteStatus(
                      String(row["submissionId"]),
                    );
                  })
                }
              >
                Check remote status
              </Button>
              <Button
                size="1"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await problemReports.deleteRemote(
                      String(row["submissionId"]),
                    );
                  })
                }
              >
                Delete received content
              </Button>
              {row["state"] === "paused" && (
                <Button
                  size="1"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await problemReports.resume(String(row["id"]));
                    })
                  }
                >
                  Resume delivery
                </Button>
              )}
            </>
          )}
          {!row["receipt"] && row["state"] !== "sending" && (
            <Button
              size="1"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await problemReports.deleteLocal(String(row["id"]), false);
                })
              }
            >
              Delete local draft
            </Button>
          )}
          {row.state !== "sending" && (
            <Button
              size="1"
              variant="outline"
              color="red"
              disabled={busy}
              onClick={() => {
                setDiscardReport(row.id);
                setDiscardAcknowledged(false);
              }}
            >
              Delete local history…
            </Button>
          )}
          {Boolean(row["receipt"]) && (
            <>
              <Text>{String(row["receipt"])}</Text>
              <Button
                size="1"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await problemReports.retainExport(
                      String(row["submissionId"]),
                      !row["retained"],
                    );
                  })
                }
              >
                {row["retained"]
                  ? "Release retained export"
                  : "Keep local export"}
              </Button>
            </>
          )}
        </Flex>
      ))}
      <Dialog.Root
        open={discardReport !== null}
        onOpenChange={(open) => {
          if (!open) setDiscardReport(null);
        }}
      >
        <Dialog.Content>
          <Dialog.Title>Delete local report and history?</Dialog.Title>
          <Dialog.Description>
            This removes the draft, local exports, and all receipt secrets for
            its submissions. It does not delete remote reports. Afterward you
            cannot check their status or request deletion from this device.
          </Dialog.Description>
          <label>
            <input
              type="checkbox"
              checked={discardAcknowledged}
              onChange={(event) => setDiscardAcknowledged(event.target.checked)}
            />{" "}
            I understand that I will lose receipt access.
          </label>
          <Flex gap="2" mt="3">
            <Dialog.Close>
              <Button variant="outline">Keep history</Button>
            </Dialog.Close>
            <Button
              color="red"
              disabled={busy || !discardAcknowledged}
              onClick={() =>
                void run(async () => {
                  if (discardReport) {
                    await problemReports.deleteLocal(discardReport, true);
                    setDiscardReport(null);
                  }
                })
              }
            >
              Delete local report and receipt access
            </Button>
          </Flex>
        </Dialog.Content>
      </Dialog.Root>
      {error && (
        <Text color="red" role="alert">
          {error}
        </Text>
      )}
    </Flex>
  );
}
