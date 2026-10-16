import { userFacingError } from "@workspace/client-kit-web/userFacingError";
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

export const REPORTING_COPY =
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
      .catch((cause) => setError(userFacingError(cause)))
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
      setError(userFacingError(cause));
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
          <Text role="alert">Could not save reporting preference. {error}</Text>
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
          <Dialog.Description>{REPORTING_COPY}</Dialog.Description>
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
