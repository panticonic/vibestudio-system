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
import {
  reportDraftContent,
  REPORT_POLICY,
} from "@vibestudio/service-schemas/problemReportBundle";

const COPY =
  "When enabled, improvement information includes automatic error reports and coarse usage counters: reporting-enabled runtime minutes, product surface opens, browser navigation counts, entities/contexts created, drafts, previews, and submissions. Automatic reports share product components, stable error codes, versions, known product source frames, occurrence counts, and a random installation pseudonym. Usage counters contain no identifiers. They exclude chat, code, console text, exception messages, screenshots, and agent narrative. Ordinary local diagnostics remain available when sharing is off. Manual reports always require your review.";
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
        ? `Server choice unavailable: ${String(server.reason)}`
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
  const firstUse = decisions?.device.state === "undecided";
  const required =
    active &&
    (!ready ||
      firstUse ||
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
      dirty.current = false;
    } catch (cause) {
      await reload();
      throw cause;
    }
  };
  const details = (
    <details>
      <summary>What is shared?</summary>
      <Text as="p" size="1">
        {COPY}
      </Text>
      <Text as="p" size="1">
        Reports go to {REPORT_POLICY.destination}. Bundles are retained for 90
        days; active investigations can be pinned. Each machine signs reports
        with a random public key that links its reports. The private key stays
        in the host secret store. No reporting account or login is needed.
      </Text>
    </details>
  );
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
        Your previous choice is selected. Saved when you accept this review,
        {decisions?.server
          ? " for this device and your account on this server"
          : " for this device"}
        . This preference is shared across workspaces and can be changed in
        Settings.
        {enabled === "indeterminate" &&
          " Device and server choices currently differ; leave this unchanged to preserve both."}
      </Text>
      {details}
      {status}
    </section>
  );
  return {
    required,
    save,
    content,
    ready,
    firstUse,
    details,
    status,
  };
}

/** The only separate reporting prompt; audit presentation waits for this decision. */
export function ReportingFirstUse({ children }: { children: ReactNode }) {
  const { problemReports } = useShellWorkspaceClient();
  const setup = useReportingSetup(problemReports, true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const open = !!setup.firstUse || busy || !!error;
  useShellOverlay(open);
  const choose = async (state: "on" | "off") => {
    setBusy(true);
    setError("");
    try {
      await setup.save(state);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <ReportingReadyContext.Provider value={setup.ready && !open && !busy}>
      {!setup.ready && (
        <div data-shell-top-chrome="reporting-choice-status">
          {setup.status}
        </div>
      )}
      <Dialog.Root open={open}>
        <Dialog.Content
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <Dialog.Title>Help Vibestudio improve</Dialog.Title>
          <Dialog.Description>
            Share automatic error reports and coarse usage counters from this
            device and your account on the connected server. Your choice is
            remembered across workspaces. You can change it in Settings or a
            workspace's unit audit.
          </Dialog.Description>
          {setup.details}
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

function ConnectedServerReportingChoice() {
  const { problemReports } = useShellWorkspaceClient();
  const [decision, setDecision] =
    useState<Awaited<ReturnType<typeof problemReports.serverConsent>>>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const reload = useCallback(async () => {
    try {
      setDecision(await problemReports.serverConsent());
      setError("");
    } catch (cause) {
      setError(String(cause));
    }
  }, [problemReports]);
  useEffect(() => {
    void reload();
  }, [reload]);
  useShellEvent("server-connection-changed", ({ status }) => {
    if (status === "connected") void reload();
  });
  const choose = async (state: "on" | "off") => {
    if (!decision) return;
    setBusy(true);
    try {
      setDecision(await problemReports.decideServer(decision.revision, state));
      setError("");
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  };
  if (!decision && !error) return null;
  const content = (
    <>
      <Text as="p">
        Your account on the connected server has a separate sharing choice:{" "}
        {decision?.state ?? "unavailable"}. It controls server-side errors and
        coarse runtime counters, including agent operations. It applies across
        your workspaces on this server. Changing it does not change this
        device's choice or another user's choice.
      </Text>
      {decision && (
        <Flex gap="3" mt="3">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void choose("on")}
          >
            Enable server reports
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void choose("off")}
          >
            Keep server reports off
          </Button>
        </Flex>
      )}
      {error && (
        <>
          <Text role="alert">Server reporting choice unavailable: {error}</Text>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void reload()}
          >
            Retry server reporting choice
          </Button>
        </>
      )}
    </>
  );
  return (
    <section aria-label="Server improvement reporting">
      <Text size="4" weight="bold">
        Server reporting
      </Text>
      {content}
    </section>
  );
}

export function ProblemReportingSection() {
  const { problemReports, app } = useShellWorkspaceClient();
  const [decision, setDecision] = useState<Awaited<
    ReturnType<typeof problemReports.consent>
  > | null>(null);
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
  const refresh = useCallback(async () => {
    const [consent, rows, , observations] = await Promise.all([
      problemReports.consent(),
      problemReports.history(),
      problemReports.availability(),
      problemReports.incidents(),
    ]);
    setDecision(consent);
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
      <Text>
        Capture installation choice: {decision?.state ?? "loading"}. Turning off
        cancels queued automatic reports. Requests already accepted may finish.
      </Text>
      <Flex gap="3">
        <Button
          disabled={busy || !decision}
          onClick={() =>
            void run(async () => {
              setDecision(
                await problemReports.decide(decision!.revision, "on"),
              );
            })
          }
        >
          Enable automatic reports
        </Button>
        <Button
          variant="outline"
          disabled={busy || !decision}
          onClick={() =>
            void run(async () => {
              setDecision(
                await problemReports.decide(decision!.revision, "off"),
              );
            })
          }
        >
          Keep automatic reports off
        </Button>
      </Flex>
      <ConnectedServerReportingChoice />
      <Text>
        Talk with an agent about what went wrong. It will investigate, assemble
        the report, and ask your approval before sharing it.
      </Text>
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
