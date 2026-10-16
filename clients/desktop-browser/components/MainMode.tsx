import { useShellWorkspaceClient } from "../shell/workspaceContext";
import { useCallback, useEffect } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { AppDialog } from "@workspace/ui/overlay";

import {
  settingsDialogAtom,
  workspaceChooserDialogOpenAtom,
  workspaceChooserTemplateAtom,
  workspaceCreationSourceUrlAtom,
} from "../state/appModeAtoms";

import { useShellEvent } from "../shell/useShellEvent";
import { useClientMenu } from "../shell/useClientMenu";
import { useShellOverlay } from "../shell/useShellOverlay";
import { ConnectionSettingsDialog } from "./ConnectionSettingsDialog";
import {
  ApprovalPresentationContext,
  useApprovalPresentationController,
} from "./ApprovalPresentationContext";
import { WorkspaceDesktop } from "./WorkspaceDesktop";
import { deferredFeature } from "./deferredFeature";
import { WorkspaceConnectionNotice } from "./WorkspaceConnectionNotice";
import { DesktopClientUpdatePrompt, DesktopClientUpdates } from "./DesktopClientUpdates";

const WorkspaceChooser = deferredFeature(async () => ({
  default: (await import("./WorkspaceChooser")).WorkspaceChooser,
}));

/**
 * Main mode: the normal desktop startup surface with the panel app and its
 * workspace dialogs. Optional feature toolchains below this boundary remain
 * lazy, but the panel chrome itself is required for first useful paint.
 */
export default function MainMode() {
  const client = useShellWorkspaceClient();
  const approvalPresentation = useApprovalPresentationController(client);

  const workspaceChooserOpen = useAtomValue(workspaceChooserDialogOpenAtom);
  const setCreationTemplate = useSetAtom(workspaceChooserTemplateAtom);
  const setCreationSource = useSetAtom(workspaceCreationSourceUrlAtom);
  const setWorkspaceChooserOpen = useSetAtom(workspaceChooserDialogOpenAtom);
  const settingsTarget = useAtomValue(settingsDialogAtom);
  const setSettingsTarget = useSetAtom(settingsDialogAtom);

  // Mounted here, not next to the badge that opens it: the badge lives in the
  // panel tree, which breadcrumb mode unmounts, but this event arrives in both.
  useShellEvent(
    "open-settings",
    useCallback((target) => setSettingsTarget(target), [setSettingsTarget]),
  );

  // This client's native menus; the host builds them from this data and relays choices back.
  const { app, notification } = client;
  useClientMenu({
    clearBuildCache: useCallback(() => app.clearBuildCache(), [app]),
    failed: useCallback(
      (action: string, error: unknown) => {
        void notification.show({
          type: "error",
          title: "That menu command failed",
          message: `${action}: ${error instanceof Error ? error.message : String(error)}`,
        });
      },
      [notification],
    ),
  });

  // Register shell overlays — hides panel views so dialogs aren't obscured
  useShellOverlay(workspaceChooserOpen);

  useEffect(() => {
    const bridge = (
      globalThis as {
        __vibestudioClient?: {
          setChromeInteractiveFocus?: (active: boolean) => void;
        };
      }
    ).__vibestudioClient;
    const isInteractive = (target: EventTarget | null) =>
      target instanceof Element &&
      target.closest(
        'input, textarea, select, button, a[href], [contenteditable="true"], [role="button"], [role="treeitem"], [role="dialog"], [tabindex]:not([tabindex="-1"])',
      ) !== null;
    const sync = (event: FocusEvent) =>
      bridge?.setChromeInteractiveFocus?.(isInteractive(event.target));
    const clear = () => bridge?.setChromeInteractiveFocus?.(false);
    document.addEventListener("focusin", sync, true);
    window.addEventListener("blur", clear);
    return () => {
      document.removeEventListener("focusin", sync, true);
      window.removeEventListener("blur", clear);
      clear();
    };
  }, []);

  return (
    <ApprovalPresentationContext.Provider value={approvalPresentation}>
      <DesktopClientUpdates>
        <WorkspaceDesktop
          connectionNotice={
            <>
              <WorkspaceConnectionNotice
                onOpenSettings={() => setSettingsTarget({ section: "connection" })}
              />
              <DesktopClientUpdatePrompt />
            </>
          }
        >
          {/* Workspace creation */}
          <AppDialog
            open={workspaceChooserOpen}
            onOpenChange={(open) => {
              setWorkspaceChooserOpen(open);
              if (!open) {
                setCreationTemplate(null);
                setCreationSource(null);
              }
            }}
            maxWidth="920px"
            className="workspace-creation-dialog"
            title="Create a workspace"
            description="A home for your projects, panels and conversations."
          >
            <button
              className="workspace-creation-close"
              aria-label="Close workspace setup"
              onClick={() => {
                setWorkspaceChooserOpen(false);
                setCreationTemplate(null);
                setCreationSource(null);
              }}
            >
              ×
            </button>
            <WorkspaceChooser />
          </AppDialog>
        </WorkspaceDesktop>

        <ConnectionSettingsDialog
          section={settingsTarget?.section ?? null}
          workspaceId={settingsTarget?.workspaceId}
          onSectionChange={(section) =>
            setSettingsTarget(section ? { ...settingsTarget, section } : null)
          }
        />
      </DesktopClientUpdates>
    </ApprovalPresentationContext.Provider>
  );
}
