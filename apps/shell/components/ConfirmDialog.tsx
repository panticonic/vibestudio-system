/**
 * Themed replacement for window.confirm. Call `confirmAction(...)` from any
 * event handler; <ConfirmDialogHost /> (mounted once in App) renders it.
 * Native confirm is unavailable/unstyled in Electron and cannot be hidden
 * behind the native panel overlay machinery.
 */

import { useSyncExternalStore } from "react";
import { AlertDialog, Button, Flex } from "@radix-ui/themes";
import { useShellOverlay } from "../shell/useShellOverlay";

export interface ConfirmRequest {
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
}

interface PendingConfirm extends ConfirmRequest {
  resolve: (confirmed: boolean) => void;
}

let pending: PendingConfirm[] = [];
const listeners = new Set<() => void>();

function publish(next: PendingConfirm[]): void {
  pending = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Resolves true when the user confirms, false when they cancel or dismiss. */
export function confirmAction(request: ConfirmRequest): Promise<boolean> {
  return new Promise((resolve) => {
    publish([...pending, { ...request, resolve }]);
  });
}

/** The shared wording for closing (archiving) a panel that has sub-panels. */
export function confirmClosePanel(title: string, subPanelCount: number): Promise<boolean> {
  return confirmAction({
    title: `Close “${title}” and its ${subPanelCount} sub-panel${subPanelCount === 1 ? "" : "s"}?`,
    confirmLabel: "Close panel",
    destructive: true,
  });
}

export function ConfirmDialogHost() {
  const current = useSyncExternalStore(subscribe, () => pending[0] ?? null);
  useShellOverlay(current !== null);
  if (!current) return null;

  const settle = (confirmed: boolean) => {
    current.resolve(confirmed);
    publish(pending.filter((entry) => entry !== current));
  };

  return (
    <AlertDialog.Root open onOpenChange={(open) => !open && settle(false)}>
      <AlertDialog.Content maxWidth="440px">
        <AlertDialog.Title size="3">{current.title}</AlertDialog.Title>
        {current.description ? (
          <AlertDialog.Description size="2">{current.description}</AlertDialog.Description>
        ) : null}
        <Flex gap="3" justify="end" mt="4">
          <AlertDialog.Cancel>
            <Button variant="soft" color="gray">
              Cancel
            </Button>
          </AlertDialog.Cancel>
          <AlertDialog.Action>
            <Button
              color={current.destructive ? "red" : undefined}
              onClick={() => settle(true)}
            >
              {current.confirmLabel ?? "Confirm"}
            </Button>
          </AlertDialog.Action>
        </Flex>
      </AlertDialog.Content>
    </AlertDialog.Root>
  );
}
