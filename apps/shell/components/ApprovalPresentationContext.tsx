import { rpcDestinationKey, type RpcDestination } from "@vibestudio/rpc";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { actionableRuntimeApprovals } from "@vibestudio/shared/approvalVisibility";
import type { InstallReviewResolution } from "@vibestudio/service-schemas/shellApproval";
import type { PendingApproval } from "@vibestudio/shared/approvals";
import type { ShellWorkspaceClient } from "../shell/workspaceClient";
import {
  approvalPresentationKey,
  createApprovalPresentationState,
  reconcileApprovalPresentation,
  selectApprovalPresentation,
  stepApprovalPresentation,
  type ApprovalPresentationState,
} from "@vibestudio/shared/approvalPresentation";

type Owner = {
  owner: RpcDestination;
  token: symbol;
  pending: readonly PendingApproval[];
};
export type PresentedApproval = {
  owner: RpcDestination;
  workspaceId?: string;
  approval: PendingApproval;
  approvalId: string;
  actionable: boolean;
};

export type WindowInstallResult = {
  owner: RpcDestination;
  resolution: InstallReviewResolution;
};

/** A window presentation index. Requests and decision authority stay with their workspace controllers. */
export function useApprovalPresentationController(
  client: ShellWorkspaceClient,
) {
  const [owners, setOwners] = useState(new Map<string, Owner>());
  const [state, setState] = useState<ApprovalPresentationState>(
    createApprovalPresentationState,
  );
  const [requestedWorkspace, setRequestedWorkspace] = useState<{
    workspaceId: string;
    approvalId?: string;
  } | null>(null);
  // One window history of outcomes: replace transient confirmations, retain
  // failed receipts until the person explicitly dismisses them.
  const [installResults, setInstallResults] = useState<WindowInstallResult[]>(
    [],
  );
  const dismissInstallResult = useCallback((result: WindowInstallResult) => {
    setInstallResults((current) => current.filter((item) => item !== result));
  }, []);
  const recordInstallResult = useCallback(
    (owner: RpcDestination, resolution: InstallReviewResolution) => {
      setInstallResults((current) => [
        ...current.filter(
          (item) =>
            (item.resolution.landing?.failed.length ?? 0) > 0 &&
            !(
              rpcDestinationKey(item.owner) === rpcDestinationKey(owner) &&
              item.resolution.approvalId === resolution.approvalId
            ),
        ),
        { owner, resolution },
      ]);
    },
    [],
  );
  const confirmation = installResults.find(
    (item) => (item.resolution.landing?.failed.length ?? 0) === 0,
  );
  useEffect(() => {
    if (!confirmation) return;
    const { resolution } = confirmation;
    const workspaceReady =
      resolution.mode === "adopt-root" &&
      resolution.decision === "accepted" &&
      resolution.landing !== undefined;
    const timer = window.setTimeout(
      () => dismissInstallResult(confirmation),
      workspaceReady ? 5_000 : 8_000,
    );
    return () => window.clearTimeout(timer);
  }, [confirmation, dismissInstallResult]);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [anchorId, setAnchorId] = useState<string | null>(null);
  const entries = useMemo<PresentedApproval[]>(
    () =>
      [...owners.values()].flatMap((owner) => {
        const actionable = new Set(
          actionableRuntimeApprovals([...owner.pending]).map(
            (approval) => approval.approvalId,
          ),
        );
        return owner.pending.map((approval) => ({
          owner: owner.owner,
          workspaceId:
            owner.owner.kind === "workspace"
              ? owner.owner.workspaceId
              : undefined,
          approval,
          approvalId: approval.approvalId,
          actionable: actionable.has(approval.approvalId),
        }));
      }),
    [owners],
  );
  let next = reconcileApprovalPresentation(state, entries);
  if (requestedWorkspace) {
    const requested =
      entries.find(
        (entry) =>
          entry.workspaceId === requestedWorkspace.workspaceId &&
          (!requestedWorkspace.approvalId ||
            entry.approvalId === requestedWorkspace.approvalId) &&
          entry.actionable,
      ) ??
      entries.find(
        (entry) =>
          entry.workspaceId === requestedWorkspace.workspaceId &&
          (!requestedWorkspace.approvalId ||
            entry.approvalId === requestedWorkspace.approvalId),
      );
    if (requested) {
      next = selectApprovalPresentation(
        next,
        entries,
        approvalPresentationKey(requested),
      );
      setRequestedWorkspace(null);
    }
  }
  if (next !== state) setState(next);
  const publish = useCallback(
    (
      owner: RpcDestination,
      token: symbol,
      pending: readonly PendingApproval[],
    ) => {
      const ownerKey = rpcDestinationKey(owner);
      setOwners((current) => {
        if (
          current.get(ownerKey)?.token === token &&
          current.get(ownerKey)?.pending === pending
        )
          return current;
        return new Map(current).set(ownerKey, { owner, token, pending });
      });
    },
    [],
  );
  const remove = useCallback((owner: RpcDestination, token: symbol) => {
    const ownerKey = rpcDestinationKey(owner);
    setOwners((current) => {
      if (current.get(ownerKey)?.token !== token) return current;
      const copy = new Map(current);
      copy.delete(ownerKey);
      return copy;
    });
  }, []);
  const request = useCallback(
    (workspaceId: string, approvalId?: string) =>
      setRequestedWorkspace({ workspaceId, approvalId }),
    [],
  );
  const minimize = useCallback(
    () => setState((current) => ({ ...current, open: false })),
    [],
  );
  const expand = useCallback(
    () => setState((current) => ({ ...current, open: true })),
    [],
  );
  const step = useCallback(
    (delta: number) =>
      setState((current) => stepApprovalPresentation(current, entries, delta)),
    [entries],
  );
  return {
    client,
    entries,
    state: next,
    host,
    setHost,
    anchorId,
    setAnchorId,
    installResults,
    recordInstallResult,
    dismissInstallResult,
    publish,
    remove,
    request,
    minimize,
    expand,
    step,
  };
}

export type ApprovalPresentation = ReturnType<
  typeof useApprovalPresentationController
>;
export const ApprovalPresentationContext =
  createContext<ApprovalPresentation | null>(null);
export function useApprovalPresentation() {
  const presentation = useContext(ApprovalPresentationContext);
  if (!presentation)
    throw new Error("Approval presentation requires the desktop window owner");
  return presentation;
}
