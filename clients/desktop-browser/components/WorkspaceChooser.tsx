import { userFacingError } from "../utils/userFacingError";
import {
  submitWorkspaceCreation,
  readWorkspaceCreationSubmission,
} from "@vibestudio/service-schemas/clients/workspaceCreationClient";
import type { WorkspaceCreationReceipt } from "@vibestudio/workspace-contracts/types";
import { useEffect, useRef, useState } from "react";
import { useAtom, useSetAtom } from "jotai";
import { Box, Button, Callout, Flex, Spinner } from "@radix-ui/themes";
import { TemplateBrowser } from "@workspace/react/templates";
import {
  useShellWorkspaceClient,
  useWorkspaceDesktopHost,
} from "../shell/workspaceContext";
import { systemWorkspaceId } from "../shell/client";
import { useApprovalPresentation } from "./ApprovalPresentationContext";
import {
  workspaceChooserDialogOpenAtom,
  workspaceChooserTemplateAtom,
  workspaceCreationSourceUrlAtom,
} from "../state/appModeAtoms";

export function WorkspaceChooser() {
  const { hubControl, templates, credentials } = useShellWorkspaceClient();
  const desktop = useWorkspaceDesktopHost();
  const approvalPresentation = useApprovalPresentation();
  const close = useSetAtom(workspaceChooserDialogOpenAtom);
  const [sourceUrl, setSourceUrl] = useAtom(workspaceCreationSourceUrlAtom);
  const [template, setTemplate] = useAtom(workspaceChooserTemplateAtom);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<WorkspaceCreationReceipt | null>(null);
  const pending = useRef(false);
  const [restoring, setRestoring] = useState(true);
  const [recoveryNotice, setRecoveryNotice] = useState("");
  const [creatingName, setCreatingName] = useState<string | null>(null);
  const [recoveredInput, setRecoveredInput] =
    useState<ReturnType<typeof readWorkspaceCreationSubmission>>(null);
  useEffect(() => {
    let live = true;
    void hubControl
      .getProfile(undefined)
      .then((profile) => {
        if (!live) return;
        if (!profile)
          throw new Error("The authenticated account is unavailable.");
        let stored: string | null = null;
        try {
          stored = localStorage.getItem(`workspace-creation:${profile.userId}`);
        } catch {
          // Storage can be unavailable; there is then nothing to recover.
        }
        const saved = readWorkspaceCreationSubmission(stored);
        if (saved) {
          setRecoveredInput(saved);
          setTemplate(saved.rootTemplate ?? null);
          setRecoveryNotice(
            `Creating “${saved.workspace}” may have been interrupted. Check whether it finished.`,
          );
        }
      })
      .catch((error) => {
        if (live) setError(userFacingError(error));
      })
      .finally(() => {
        if (live) setRestoring(false);
      });
    return () => {
      live = false;
    };
  }, [hubControl, setTemplate]);
  const open = async (workspaceId: string) => {
    setBusy(true);
    setError(null);
    try {
      await desktop.openWorkspace(workspaceId);
      setTemplate(null);
      setSourceUrl(null);
      close(false);
    } catch (error) {
      setError(userFacingError(error));
    } finally {
      setBusy(false);
    }
  };
  const create = async (
    workspace: string,
    rootTemplate?: import("@vibestudio/service-schemas/templates").TemplateExactPin,
    purpose: "use" | "author" = "use",
  ) => {
    if (pending.current || restoring) return;
    pending.current = true;
    setCreatingName(workspace);
    setBusy(true);
    setError(null);
    try {
      const profile = await hubControl.getProfile(undefined);
      if (!profile)
        throw new Error(
          "The authenticated account is unavailable; workspace creation was not submitted.",
        );
      const entry = await submitWorkspaceCreation(
        hubControl,
        {
          workspace,
          purpose,
          ...(rootTemplate ? { rootTemplate } : {}),
        },
        {
          key: `workspace-creation:${profile.userId}`,
          getItem: (key) => storage(() => localStorage.getItem(key), null),
          setItem: (key, value) => storage(() => localStorage.setItem(key, value), undefined),
          removeItem: (key) => storage(() => localStorage.removeItem(key), undefined),
          newOperationId: () => crypto.randomUUID(),
        },
      );
      setRecoveredInput(null);
      setRecoveryNotice("");
      if (entry.state === "deleted")
        throw new Error(
          "The earlier creation completed, but its workspace was deleted. Choose Create again only to install a new workspace.",
        );
      setCreated(entry);
      await open(entry.workspaceId);
    } catch (error) {
      setError(userFacingError(error));
    } finally {
      pending.current = false;
      setCreatingName(null);
      setBusy(false);
    }
  };
  return (
    <Box p="0" style={{ minWidth: 0 }}>
      <Flex direction="column" gap="4">
        {recoveryNotice ? (
          <Callout.Root>
            <Callout.Text>{recoveryNotice}</Callout.Text>
          </Callout.Root>
        ) : null}
        {error ? (
          <Callout.Root color="red" role="alert">
            <Callout.Text>{error}</Callout.Text>
          </Callout.Root>
        ) : null}
        {creatingName ? (
          <Callout.Root role="status">
            <Callout.Text>Creating “{creatingName}”…</Callout.Text>
          </Callout.Root>
        ) : null}
        {created ? (
          <Button
            size="3"
            disabled={busy}
            onClick={() => void open(created.workspaceId)}
          >
            Open workspace
          </Button>
        ) : restoring ? (
          <Spinner aria-label="Checking for an interrupted creation" />
        ) : recoveredInput ? (
          <Button
            disabled={busy}
            onClick={() =>
              void create(
                recoveredInput.workspace,
                recoveredInput.rootTemplate,
                recoveredInput.purpose,
              )
            }
          >
            Continue previous creation
          </Button>
        ) : (
          <TemplateBrowser
            listSourceAccounts={credentials?.listStoredCredentials}
            client={templates}
            onChooseFolder={desktop.inspectWorkspaceFolder}
            initialSourceUrl={sourceUrl ?? undefined}
            initialPin={template ?? undefined}
            onCreate={create}
            onCreateFresh={(name) => create(name)}
            onReviewPending={(approvalId) => {
              void systemWorkspaceId
                .then((ownerId) => {
                  approvalPresentation.request(ownerId, approvalId);
                  close(false);
                })
                .catch((cause: unknown) => {
                  setError(
                    userFacingError(cause),
                  );
                });
            }}
          />
        )}
      </Flex>
    </Box>
  );
}

function storage<T>(access: () => T, fallback: T): T {
  try {
    return access();
  } catch {
    return fallback;
  }
}
