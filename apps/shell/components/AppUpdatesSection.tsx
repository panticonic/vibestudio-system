import { userFacingError } from "../utils/userFacingError";
import { useShellWorkspaceClient } from "../shell/workspaceContext";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Button, Callout, Code, Flex, Table, Text, Tooltip } from "@radix-ui/themes";
import { ExclamationTriangleIcon } from "@radix-ui/react-icons";
import { type app, type supervisedUnits } from "../shell/client";
import { useShellEvent } from "../shell/useShellEvent";

type PendingUpdate = Awaited<ReturnType<typeof app.listPendingUpdates>>[number];
type SupervisedUnit = Awaited<ReturnType<typeof supervisedUnits.list>>[number];
type ReleaseVersions = Awaited<ReturnType<typeof supervisedUnits.versions>>;
type AppUnit = SupervisedUnit & { versions: ReleaseVersions };
type UnitHealth = Awaited<ReturnType<typeof supervisedUnits.health>>;

export function AppUpdatesSection({ showHeading = true }: { showHeading?: boolean } = {}) {
  const { app, notification, supervisedUnits } = useShellWorkspaceClient();

  const [pending, setPending] = useState<PendingUpdate[]>([]);
  const [apps, setApps] = useState<AppUnit[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedDiagnostics, setExpandedDiagnostics] = useState<Record<string, UnitHealth>>({});

  const load = useCallback(async () => {
    try {
      setError(null);
      const [pendingUpdates, units] = await Promise.all([
        app.listPendingUpdates(),
        supervisedUnits.list(),
      ]);
      setPending(pendingUpdates);
      const appUnits = units.filter((unit) => unit.identity.kind === "app");
      setApps(
        await Promise.all(
          appUnits.map(async (unit) => ({
            ...unit,
            versions: await supervisedUnits.versions(unit.identity.entityId),
          }))
        )
      );
    } catch (err) {
      setError(userFacingError(err));
    } finally {
      setLoaded(true);
    }
  }, []);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
  }, [load]);

  useShellEvent(
    "apps:available",
    useCallback(() => {
      void load();
    }, [load])
  );
  useShellEvent(
    "apps:status",
    useCallback(() => {
      void load();
    }, [load])
  );
  useShellEvent(
    "apps:lifecycle",
    useCallback(() => {
      void load();
    }, [load])
  );

  const pendingByApp = useMemo(
    () => new Map(pending.map((update) => [update.appId, update])),
    [pending]
  );

  const loadUpdate = async (appId: string) => {
    setBusy(`apply:${appId}`);
    try {
      setError(null);
      const result = await app.applyUpdate(appId);
      if (!result.applied) setError(`${appId} has no pending desktop update.`);
      await load();
    } catch (err) {
      setError(userFacingError(err));
    } finally {
      setBusy(null);
    }
  };

  const rollback = async (appId: string, buildKey?: string) => {
    setBusy(`rollback:${appId}:${buildKey ?? "latest"}`);
    try {
      setError(null);
      await supervisedUnits.rollback(appId, { buildKey });
      await load();
      void notification.show({
        type: "success",
        title: "App rolled back",
        message: buildKey
          ? `${appId} restored an earlier version.`
          : `${appId} restored the previous version.`,
      });
    } catch (err) {
      setError(userFacingError(err));
    } finally {
      setBusy(null);
    }
  };

  const restart = async (appId: string) => {
    setBusy(`restart:${appId}`);
    try {
      setError(null);
      await supervisedUnits.restart({ kind: "app", entityId: appId });
      await load();
      await loadDiagnostics(appId);
    } catch (err) {
      setError(userFacingError(err));
    } finally {
      setBusy(null);
    }
  };

  const loadDiagnostics = async (appId: string) => {
    setBusy(`diagnostics:${appId}`);
    try {
      setError(null);
      const diagnostics = await supervisedUnits.health(
        { kind: "app", entityId: appId },
        { limit: 80, errorLimit: 20 }
      );
      setExpandedDiagnostics((current) => ({ ...current, [appId]: diagnostics }));
    } catch (err) {
      setError(userFacingError(err));
    } finally {
      setBusy(null);
    }
  };

  const toggleDiagnostics = async (appId: string) => {
    if (expandedDiagnostics[appId]) {
      setExpandedDiagnostics((current) => {
        const next = { ...current };
        delete next[appId];
        return next;
      });
      return;
    }
    await loadDiagnostics(appId);
  };


  return (
    <Flex direction="column" gap="2">
      <Flex justify={showHeading ? "between" : "end"} align="center">
        {showHeading ? (
          <Text size="2" weight="medium">
            App updates
          </Text>
        ) : null}
        <Button size="1" variant="soft" disabled={refreshing} onClick={() => void refresh()}>
          {refreshing ? "Refreshing…" : "Refresh"}
        </Button>
      </Flex>
      {error ? (
        <Callout.Root size="1" color="amber">
          <Callout.Icon>
            <ExclamationTriangleIcon />
          </Callout.Icon>
          <Callout.Text>{error}</Callout.Text>
        </Callout.Root>
      ) : null}
      {loaded && apps.length === 0 && !error ? (
        <Text size="2" color="gray">
          No apps installed yet.
        </Text>
      ) : null}
      {apps.length > 0 ? (
      <Table.Root size="1" variant="surface">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeaderCell>App</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Target</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Version</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell>Earlier versions</Table.ColumnHeaderCell>
            <Table.ColumnHeaderCell />
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {apps.map((unit) => {
            const appId = unit.identity.entityId;
            const pendingUpdate = pendingByApp.get(appId);
            const latestPrevious = unit.versions.previous[0];
            const diagnostics = expandedDiagnostics[appId];
            return (
              <Fragment key={appId}>
                <Table.Row>
                  <Table.Cell>
                    <Flex direction="column" gap="1">
                      <Text size="2">{unit.displayName ?? appId}</Text>
                      <Code size="1">{unit.source}</Code>
                    </Flex>
                  </Table.Cell>
                  <Table.Cell>{unit.identity.kind}</Table.Cell>
                  <Table.Cell>
                    <Flex direction="column" gap="1">
                      <Badge color={statusColor(unit.status)}>{statusLabel(unit.status)}</Badge>
                      {pendingUpdate ? <Badge color="blue">pending desktop update</Badge> : null}
                      {unit.lastError ? (
                        <Text size="1" color="red">
                          {unit.lastError}
                        </Text>
                      ) : null}
                    </Flex>
                  </Table.Cell>
                  <Table.Cell>
                    <BuildLabel buildKey={unit.artifact.buildKey} label="Current" />
                  </Table.Cell>
                  <Table.Cell>
                    <Flex direction="column" gap="1">
                      <Text size="1" color="gray">
                        {unit.versions.previous.length} of {unit.versions.retentionLimit} kept
                      </Text>
                      {latestPrevious ? (
                        <BuildLabel buildKey={latestPrevious.buildKey} label="Previous" />
                      ) : null}
                    </Flex>
                  </Table.Cell>
                  <Table.Cell>
                    <Flex gap="1" justify="end" wrap="wrap">
                      {pendingUpdate ? (
                        <Button
                          size="1"
                          disabled={busy === `apply:${appId}`}
                          onClick={() => void loadUpdate(appId)}
                        >
                          Apply update
                        </Button>
                      ) : null}
                      <Button
                        size="1"
                        variant="soft"
                        disabled={busy === `restart:${appId}` || !unit.artifact.buildKey}
                        onClick={() => void restart(appId)}
                      >
                        Restart
                      </Button>
                      <Button
                        size="1"
                        variant="ghost"
                        disabled={busy === `diagnostics:${appId}`}
                        onClick={() => void toggleDiagnostics(appId)}
                      >
                        Diagnostics
                      </Button>
                      {latestPrevious ? (
                        <Button
                          size="1"
                          variant="soft"
                          disabled={busy?.startsWith(`rollback:${appId}:`) ?? false}
                          onClick={() => void rollback(appId)}
                        >
                          Roll back
                        </Button>
                      ) : null}
                    </Flex>
                  </Table.Cell>
                </Table.Row>
                {diagnostics ? (
                  <Table.Row key={`${appId}:diagnostics`}>
                    <Table.Cell colSpan={6}>
                      <Flex direction="column" gap="2">
                        {diagnostics.errors.length > 0 ? (
                          <Flex direction="column" gap="1">
                            <Text size="1" weight="medium" color="red">
                              Errors
                            </Text>
                            {diagnostics.errors.map((row) => (
                              <Text
                                as="div"
                                size="1"
                                color="red"
                                key={`${row.timestamp}:${row.source ?? ""}:${row.message}`}
                              >
                                {row.source ? <Code size="1">{row.source}</Code> : null}{" "}
                                {row.message}
                              </Text>
                            ))}
                          </Flex>
                        ) : null}
                        <Flex direction="column" gap="1">
                          <Text size="1" weight="medium">
                            Logs
                          </Text>
                          {diagnostics.logs.length === 0 ? (
                            <Text size="1" color="gray">
                              No logs
                            </Text>
                          ) : (
                            diagnostics.logs.map((row) => (
                              <Text
                                as="div"
                                size="1"
                                color={row.level === "error" ? "red" : "gray"}
                                key={`${row.timestamp}:${row.source ?? ""}:${row.message}`}
                              >
                                <Code size="1">{row.level}</Code>{" "}
                                {row.source ? <Code size="1">{row.source}</Code> : null}{" "}
                                {row.message}
                              </Text>
                            ))
                          )}
                        </Flex>
                        {diagnostics.dropped.entries > 0 || diagnostics.dropped.errors > 0 ? (
                          <Text size="1" color="amber">
                            Dropped {diagnostics.dropped.entries} log entries and{" "}
                            {diagnostics.dropped.errors} errors from the diagnostics buffer.
                          </Text>
                        ) : null}
                      </Flex>
                    </Table.Cell>
                  </Table.Row>
                ) : null}
              </Fragment>
            );
          })}
        </Table.Body>
      </Table.Root>
      ) : null}
    </Flex>
  );
}

function BuildLabel({ buildKey, label }: { buildKey: string | null | undefined; label: string }) {
  if (!buildKey) return <Text size="1" color="gray">None</Text>;
  return (
    <Tooltip content={`Build ${buildKey}`}>
      <Text size="1">{label}</Text>
    </Tooltip>
  );
}

const STATUS_LABELS: Record<string, string> = {
  running: "Running",
  available: "Ready",
  error: "Error",
  "pending-approval": "Needs approval",
  building: "Building",
  stopped: "Stopped",
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.replace(/-/g, " ");
}

function statusColor(status: string): "green" | "red" | "amber" | "blue" | "gray" {
  if (status === "running" || status === "available") return "green";
  if (status === "error") return "red";
  if (status === "pending-approval") return "amber";
  if (status === "building") return "blue";
  return "gray";
}
