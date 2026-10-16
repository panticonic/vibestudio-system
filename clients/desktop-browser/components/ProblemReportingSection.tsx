import { userFacingError } from "../utils/userFacingError";
import { problemReportingConversation } from "@vibestudio/shared/problemReportingConversation";
import { reportDraftContent } from "@vibestudio/service-schemas/problemReportBundle";
import { useCallback, useEffect, useState } from "react";
import { Button, Checkbox, Dialog, Flex, Text } from "@radix-ui/themes";
import { useShellWorkspaceClient } from "../shell/workspaceContext";
import { REPORTING_COPY as COPY, useReportingSetup } from "./ProblemReporting";

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
    void refresh().catch((error) => setError(userFacingError(error)));
  }, [refresh]);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
    } catch (error) {
      setError(userFacingError(error));
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
      {incidents.length === 0 && (
        <Text size="2" color="gray">
          No problems recorded on this device.
        </Text>
      )}
      {incidents.map((incident) => (
        <Flex key={String(incident["id"])} gap="2" wrap="wrap">
          <Text>
            {formatWhen(incident["last_at"])} · {String(incident["count"])}{" "}
            {Number(incident["count"]) === 1 ? "time" : "times"} ·{" "}
            {String(incident["value"])}
          </Text>
          <Button
            size="1"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const draft = await problemReports.create(
                  parseIncidentValue(incident["value"]),
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
      {history.length === 0 && (
        <Text size="2" color="gray">
          No reports yet.
        </Text>
      )}
      {history.map((row, index) => (
        <Flex key={`${row["id"]}-${index}`} gap="2" wrap="wrap">
          <Text>
            {formatWhen(row["updated_at"])} · {String(row["state"] ?? "draft")}{" "}
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

function formatWhen(value: unknown): string {
  const date = new Date(typeof value === "number" ? value : String(value));
  return Number.isNaN(date.getTime()) ? String(value ?? "") : date.toLocaleString();
}

function parseIncidentValue(value: unknown): ReturnType<typeof JSON.parse> {
  try {
    return JSON.parse(String(value));
  } catch {
    throw new Error("This problem's details could not be read, so it can't be reported.");
  }
}
