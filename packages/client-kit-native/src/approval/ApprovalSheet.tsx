import ReactNativeHapticFeedback from "react-native-haptic-feedback";
import { AppModal } from "../ui/AppModal";
import { X } from "../ui/icons";
import { useKitColors } from "../ui/theme";
import { shadow, spacing, type as typeRamp } from "../ui/tokens";
import {
  getApprovalAttribution,
  getApprovalCopy,
  getApprovalRiskTone,
  shouldOpenApprovalDetails,
  shouldShowOperationSubstance,
} from "@vibestudio/shared/approvalCopy";
import {
  type ApprovalDecision,
  type DiffReviewEntry,
  type DiffReviewFile,
  type PendingApproval,
} from "@vibestudio/shared/approvals";
import { AUTHORITY_DOMAINS } from "@vibestudio/shared/authority/authorityDomains";
import {
  clearableRows,
  type TemplateAcceptance,
  type TemplateInstallResolution,
} from "@vibestudio/shared/authority/unitInstallReview";
import {
  defaultInstallSelection,
  installAcceptanceFrom,
  installOfferSignature,
  resolveCallerInfo,
  syncInstallSelection,
  trustChangeSection,
} from "@workspace/approvals-core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ApprovalMarkdown } from "./ApprovalMarkdown";
import { MobileDiffReview } from "./DiffReview";
import { InstallReviewDetails } from "./InstallReview";
import { DeviceCodePanel } from "./SignInPanel";
import { TrustChangeSectionView } from "./TrustChangeSection";
import {
  BrowserPermissionActions,
  ClientConfigActions,
  CredentialInputActions,
  DeviceCodeActions,
  InstallReviewActions,
  SecretInputActions,
  StandardActions,
} from "./actions";
import { ApprovalDetails } from "./details";
import { ApprovalHeader, CallerRow, WarningBand } from "./header";
import { InlineError, SecretConfigFields } from "./inputs";
import { styles } from "./styles";
import { PendingAction } from "./types";

export interface ApprovalSheetProps {
  visible?: boolean;
  workspaceName?: string;
  workspaceNames?: Readonly<Record<string, string>>;
  onClose?: () => void;
  approval: PendingApproval | null;
  queue: {
    index: number;
    total: number;
    onPrevious: () => void;
    onNext: () => void;
    status?: { message: string; actionLabel?: string; onAction?: () => void };
  };
  onResolve: (
    approvalId: string,
    decision: ApprovalDecision,
  ) => Promise<void> | void;
  onSubmitClientConfig: (
    approvalId: string,
    values: Record<string, string>,
  ) => Promise<void> | void;
  onSubmitCredentialInput: (
    approvalId: string,
    values: Record<string, string>,
  ) => Promise<void> | void;
  onSubmitSecretInput: (
    approvalId: string,
    values: Record<string, string>,
  ) => Promise<void> | void;
  /**
   * Accept a review with exactly what the user allowed now, or cancel it. Every
   * part arrives either way; this decides only what is pre-authorized.
   */
  onResolveInstallReview: (
    approvalId: string,
    resolution: TemplateInstallResolution,
  ) => Promise<void> | void;
  /**
   * Optional. When supplied and the current approval comes from a panel,
   * the caller chip becomes touchable and invokes this with the panel id.
   * Mobile wires it to `activatePanel` so the user can jump to the source.
   */
  onNavigateToPanel?: (panelId: string) => void;
  /** Lazy trusted blob read. The sheet further restricts this to hashes in the approval payload. */
  onFetchDiffContent?: (
    approvalId: string,
    hash: string,
  ) => Promise<string | null>;
  /** Open the full workspace file inspector for more context or degraded files. */
  onOpenDiffFile?: (
    file: DiffReviewFile,
    entry: DiffReviewEntry,
  ) => Promise<void> | void;
}

export function ApprovalSheet({
  visible = true,
  workspaceName,
  workspaceNames,
  onClose,
  approval: current,
  queue,
  onResolve,
  onSubmitClientConfig,
  onSubmitCredentialInput,
  onSubmitSecretInput,
  onResolveInstallReview,
  onNavigateToPanel,
  onFetchDiffContent,
  onOpenDiffFile,
}: ApprovalSheetProps) {
  const colors = useKitColors();
  const insets = useSafeAreaInsets();
  const { height: viewportHeight } = useWindowDimensions();
  const browseIndex = queue.index;
  const sourceWorkspaceId =
    current?.kind === "capability"
      ? current.snapshot?.sourceWorkspaceId
      : undefined;
  const targetWorkspaceId =
    current?.kind === "capability" ? current.snapshot?.workspaceId : undefined;
  const crossesWorkspace =
    sourceWorkspaceId &&
    targetWorkspaceId &&
    sourceWorkspaceId !== targetWorkspaceId;
  const sourceWorkspaceName = sourceWorkspaceId
    ? (workspaceNames?.[sourceWorkspaceId] ?? sourceWorkspaceId)
    : "";
  const targetWorkspaceName = targetWorkspaceId
    ? (workspaceNames?.[targetWorkspaceId] ??
      workspaceName ??
      targetWorkspaceId)
    : "";
  const queueLength = queue.total;
  const canPrev = queueLength > 1 && browseIndex > 0;
  const canNext = queueLength > 1 && browseIndex < queueLength - 1;
  const [values, setValues] = useState<Record<string, string>>({});
  /**
   * What the user has allowed now, per part. Seeded from the review's own
   * defaults, so one tap accepts the complete slate with everything allowed and
   * unchecking is the dial for anyone who would rather be asked (U5).
   */
  const [installSelection, setInstallSelection] = useState<
    Map<string, Set<string>>
  >(new Map());
  // Recomputed on every render so the footer status line and the acceptance
  // payload always agree with exactly what is checked on screen right now.
  const installAllowNow: TemplateAcceptance["allowNow"] = useMemo(
    () =>
      [...installSelection].map(([identityKey, permissions]) => ({
        identityKey,
        permissions: [...permissions],
      })),
    [installSelection],
  );
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(false);
  const translateY = useRef(new Animated.Value(viewportHeight)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const dragOffset = useRef(0);

  const callerInfo = current ? resolveCallerInfo(current) : null;
  const trustChange = current ? trustChangeSection(current) : null;
  const copy = current && callerInfo ? getApprovalCopy(current) : null;
  const attribution = current ? getApprovalAttribution(current) : null;
  const riskTone = current ? getApprovalRiskTone(current) : "standard";
  const accentColor =
    riskTone === "danger"
      ? colors.danger
      : riskTone === "caution"
        ? colors.warning
        : colors.accent;

  const isBusy = pendingAction !== null;
  const currentApprovalId = current?.approvalId;
  const currentInstallOfferSignature =
    current?.kind === "unit-install-review"
      ? installOfferSignature(current.parts)
      : "";
  const previousApprovalId = useRef<string | undefined>(undefined);

  useEffect(() => {
    const approvalChanged = previousApprovalId.current !== currentApprovalId;
    previousApprovalId.current = currentApprovalId;
    if (!current) {
      if (approvalChanged) setInstallSelection(new Map());
      return;
    }
    setInstallSelection((previous) =>
      current.kind === "unit-install-review"
        ? approvalChanged
          ? defaultInstallSelection(current.parts)
          : syncInstallSelection(current.parts, previous)
        : new Map(),
    );
    if (!approvalChanged) return;
    setValues({});
    setError(null);
    setPendingAction(null);
    setMinimized(false);
    setDetailsOpen(
      shouldOpenApprovalDetails(current) ||
        (current.kind === "credential" &&
          !!current.oauthAudienceDomainMismatch),
    );
    ReactNativeHapticFeedback.trigger("impactLight");
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        stiffness: 220,
        damping: 28,
        mass: 1,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: 200,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
    if (copy && visible) {
      const requester = callerInfo
        ? `Requested by ${callerInfo.label}, ${callerInfo.kindLabel.toLowerCase()}. `
        : "";
      AccessibilityInfo.announceForAccessibility(
        `${copy.title}. ${requester}${copy.summary}`,
      );
    }
  }, [currentApprovalId, currentInstallOfferSignature, visible]);

  const runAction = useCallback(
    async (action: PendingAction, task: () => Promise<void> | void) => {
      if (isBusy) return;
      setError(null);
      setPendingAction(action);
      if (action === "deny") {
        ReactNativeHapticFeedback.trigger("notificationWarning");
      } else {
        ReactNativeHapticFeedback.trigger("impactMedium");
      }
      try {
        await task();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "Couldn't resolve. Try again.";
        setError(message || "Couldn't resolve. Try again.");
        AccessibilityInfo.announceForAccessibility(
          `Approval action failed. ${message || "Couldn't resolve. Try again."}`,
        );
      } finally {
        setPendingAction(null);
      }
    },
    [isBusy],
  );

  const dismiss = useCallback(() => {
    if (onClose) {
      onClose();
      return;
    }
    if (!current || isBusy) return;
    // Backdrop taps and swipe-down mean “not now”, not denial. Keep the queue
    // entry pending and leave a visible pill to reopen it.
    setMinimized(true);
  }, [current, isBusy, onClose]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          !isBusy &&
          gesture.dy > 8 &&
          Math.abs(gesture.dy) > Math.abs(gesture.dx),
        onPanResponderMove: (_event, gesture) => {
          const next = Math.max(0, gesture.dy);
          dragOffset.current = next;
          translateY.setValue(next);
        },
        onPanResponderRelease: (_event, gesture) => {
          if (gesture.dy > 120 || gesture.vy > 0.8) {
            ReactNativeHapticFeedback.trigger("impactLight");
            dismiss();
            return;
          }
          dragOffset.current = 0;
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            stiffness: 220,
            damping: 28,
          }).start();
        },
      }),
    [dismiss, isBusy, translateY],
  );

  const showRequestingPanel = useCallback(() => {
    if (callerInfo?.panelId && onNavigateToPanel) {
      onNavigateToPanel(callerInfo.panelId);
    }
  }, [callerInfo, onNavigateToPanel]);

  if (!current || !copy || !callerInfo) return null;

  if (minimized) {
    return (
      <View pointerEvents="box-none" style={styles.minimizedRoot}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Review pending approval: ${copy.title}`}
          onPress={() => setMinimized(false)}
          style={({ pressed }) => [
            styles.minimizedApproval,
            { backgroundColor: colors.surface, borderColor: colors.warning },
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.minimizedApprovalText, { color: colors.text }]}>
            Approval waiting · Review
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <AppModal
      visible={visible}
      onRequestClose={onClose}
      transparent
      animationType="none"
      presentationStyle="overFullScreen"
    >
      <View style={styles.modalRoot}>
        <Animated.View
          style={[
            styles.backdrop,
            { backgroundColor: colors.overlay, opacity: backdropOpacity },
          ]}
        >
          <Pressable
            accessibilityLabel="Dismiss approval"
            disabled={isBusy}
            onPress={dismiss}
            style={StyleSheet.absoluteFill}
            testID="approval-backdrop"
          />
        </Animated.View>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={styles.keyboardRoot}
        >
          <View style={styles.safeArea}>
            <Animated.View
              accessible={false}
              accessibilityViewIsModal
              style={[
                styles.sheet,
                shadow.sheet,
                {
                  backgroundColor: colors.surfaceRaised,
                  borderColor: colors.border,
                  maxHeight: viewportHeight * 0.9,
                  minHeight: viewportHeight * 0.4,
                  shadowColor: colors.shadow,
                  transform: [{ translateY }],
                },
              ]}
              testID="approval-sheet"
            >
              <View
                style={[styles.accentStripe, { backgroundColor: accentColor }]}
                testID="approval-accent-stripe"
              />
              <Pressable
                accessibilityLabel="Dismiss approval"
                accessibilityRole="button"
                disabled={isBusy}
                onPress={dismiss}
                style={[
                  styles.dismissButton,
                  { right: Math.max(insets.right, spacing.md) },
                ]}
                testID="approval-dismiss"
              >
                <X size={20} color={colors.textSecondary} />
              </Pressable>
              <View style={styles.handleWrap} {...panResponder.panHandlers}>
                <View
                  style={[styles.handle, { backgroundColor: colors.border }]}
                />
              </View>

              <ScrollView
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={[
                  styles.scrollContent,
                  {
                    paddingLeft: Math.max(insets.left, spacing.lg),
                    paddingRight: Math.max(insets.right, spacing.lg),
                  },
                ]}
              >
                {queue.status && (
                  <View style={{ paddingVertical: 8 }}>
                    <Text
                      accessibilityLiveRegion="polite"
                      style={[
                        typeRamp.caption,
                        { color: colors.textSecondary },
                      ]}
                    >
                      {queue.status.message}
                    </Text>
                    {queue.status.onAction && (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={queue.status.actionLabel}
                        onPress={queue.status.onAction}
                        style={{ minHeight: 44, justifyContent: "center" }}
                      >
                        <Text
                          style={[typeRamp.bodyStrong, { color: colors.text }]}
                        >
                          {queue.status.actionLabel}
                        </Text>
                      </Pressable>
                    )}
                  </View>
                )}
                {workspaceName && (
                  <Text
                    style={[typeRamp.caption, { color: colors.textSecondary }]}
                  >
                    {workspaceName} · Approval
                  </Text>
                )}
                {crossesWorkspace && (
                  <View
                    style={{ paddingVertical: 12 }}
                    testID="approval-workspace-direction"
                  >
                    <Text style={[typeRamp.bodyStrong, { color: colors.text }]}>
                      {sourceWorkspaceName} → {targetWorkspaceName}
                    </Text>
                    <Text
                      style={[
                        typeRamp.caption,
                        { color: colors.textSecondary },
                      ]}
                    >
                      Responses return to {sourceWorkspaceName} and may be
                      visible to its members.
                    </Text>
                  </View>
                )}
                <ApprovalHeader
                  approval={current}
                  accentColor={accentColor}
                  queueLength={queueLength}
                  queueIndex={browseIndex}
                  canPrev={canPrev}
                  canNext={canNext}
                  onPrev={queue.onPrevious}
                  onNext={queue.onNext}
                />
                {current.kind === "capability" && current.authorityRow ? (
                  <View
                    style={[
                      styles.domainChip,
                      {
                        backgroundColor: colors.surfaceSunken,
                        borderColor: colors.borderSubtle,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.domainChipText,
                        { color: colors.textSecondary },
                      ]}
                    >
                      {AUTHORITY_DOMAINS[current.authorityRow.domain].label}
                      {current.authorityRow.provenance.surface
                        ? ` · ${current.authorityRow.provenance.surface}`
                        : ""}
                    </Text>
                  </View>
                ) : null}
                <Text
                  accessibilityRole="header"
                  style={[styles.title, { color: colors.text }]}
                >
                  {copy.title}
                </Text>
                {callerInfo.kind !== "system" || attribution?.target ? (
                  <CallerRow
                    caller={callerInfo}
                    attribution={attribution ?? {}}
                    canNavigate={!!onNavigateToPanel && !!callerInfo.panelId}
                    onPress={showRequestingPanel}
                  />
                ) : null}
                {copy.summary ? (
                  <ApprovalMarkdown source={copy.summary} tone="muted" />
                ) : null}
                {copy.warning ? <WarningBand message={copy.warning} /> : null}
                {/* A trust change is the decision itself, so it leads the card
                    ahead of the request's own details. */}
                {trustChange ? (
                  <TrustChangeSectionView section={trustChange} />
                ) : null}
                {current.kind === "device-code" ? (
                  <DeviceCodePanel approval={current} />
                ) : null}
                {/* The review IS the body: parts, rows, and selection. It is
                    not a disclosure under a request summary. */}
                {current.kind === "unit-install-review" ? (
                  <InstallReviewDetails
                    approval={current}
                    selection={installSelection}
                    onTogglePart={(part, checked) =>
                      setInstallSelection((currentSelection) => {
                        const next = new Map(currentSelection);
                        next.set(
                          part.identityKey,
                          checked
                            ? new Set(
                                clearableRows(part)
                                  .filter((row) => row.selectedByDefault)
                                  .map((row) => row.key),
                              )
                            : new Set(),
                        );
                        return next;
                      })
                    }
                    onToggleRow={(part, rowKey, checked) =>
                      setInstallSelection((currentSelection) => {
                        const next = new Map(currentSelection);
                        const rows = new Set(next.get(part.identityKey) ?? []);
                        if (checked) rows.add(rowKey);
                        else rows.delete(rowKey);
                        next.set(part.identityKey, rows);
                        return next;
                      })
                    }
                  />
                ) : null}
                {current.kind === "capability" &&
                shouldShowOperationSubstance(current) ? (
                  <View style={styles.detailCard}>
                    <Text
                      style={[
                        styles.detailLabel,
                        { color: colors.textSecondary },
                      ]}
                    >
                      What exactly
                    </Text>
                    <Text style={[styles.detailValue, { color: colors.text }]}>
                      {current.operationSubstance.summary}
                    </Text>
                    {current.operationSubstance.detail ? (
                      <Text
                        style={[
                          styles.detailValue,
                          { color: colors.textSecondary },
                        ]}
                      >
                        {current.operationSubstance.detail}
                      </Text>
                    ) : null}
                    {current.operationSubstance.facts?.map((fact) => (
                      <View
                        key={`${fact.label}:${fact.value}`}
                        style={styles.substanceFact}
                      >
                        <Text
                          style={[
                            styles.substanceFactLabel,
                            { color: colors.textSecondary },
                          ]}
                        >
                          {fact.label}
                        </Text>
                        <Text
                          style={[
                            styles.substanceFactValue,
                            { color: colors.text },
                          ]}
                        >
                          {fact.value}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                {current.diffReview && current.diffReview.length > 0 ? (
                  <MobileDiffReview
                    approvalId={current.approvalId}
                    entries={current.diffReview}
                    fetchContent={onFetchDiffContent}
                    onOpenFile={
                      onOpenDiffFile
                        ? async (file, entry) => {
                            setMinimized(true);
                            await onOpenDiffFile(file, entry);
                          }
                        : undefined
                    }
                  />
                ) : null}
                {error ? <InlineError message={error} /> : null}
                {current.kind === "client-config" ||
                current.kind === "credential-input" ||
                current.kind === "secret-input" ? (
                  <SecretConfigFields
                    approval={current}
                    values={values}
                    onChange={(name, value) =>
                      setValues((previous) => ({ ...previous, [name]: value }))
                    }
                  />
                ) : null}
                <ApprovalDetails
                  approval={current}
                  caller={callerInfo}
                  open={detailsOpen}
                  onToggle={() => setDetailsOpen((open) => !open)}
                />
              </ScrollView>

              <View
                style={[
                  styles.actionBar,
                  {
                    borderTopColor: colors.borderSubtle,
                    backgroundColor: colors.surfaceRaised,
                    paddingBottom: Math.max(insets.bottom, spacing.lg),
                    paddingLeft: Math.max(insets.left, spacing.lg),
                    paddingRight: Math.max(insets.right, spacing.lg),
                  },
                ]}
              >
                {current.kind === "client-config" ? (
                  <ClientConfigActions
                    approval={current}
                    values={values}
                    busy={isBusy}
                    pendingAction={pendingAction}
                    onSubmit={() =>
                      runAction("submit-client-config", () =>
                        onSubmitClientConfig(current.approvalId, values),
                      )
                    }
                    onDeny={() =>
                      runAction("deny", () =>
                        onResolve(current.approvalId, "deny"),
                      )
                    }
                  />
                ) : current.kind === "credential-input" ? (
                  <CredentialInputActions
                    approval={current}
                    values={values}
                    busy={isBusy}
                    pendingAction={pendingAction}
                    onSubmit={() =>
                      runAction("submit-credential-input", () =>
                        onSubmitCredentialInput(current.approvalId, values),
                      )
                    }
                    onDeny={() =>
                      runAction("deny", () =>
                        onResolve(current.approvalId, "deny"),
                      )
                    }
                  />
                ) : current.kind === "secret-input" ? (
                  <SecretInputActions
                    approval={current}
                    values={values}
                    busy={isBusy}
                    pendingAction={pendingAction}
                    onSubmit={() =>
                      runAction("submit-secret-input", () =>
                        onSubmitSecretInput(current.approvalId, values),
                      )
                    }
                    onDeny={() =>
                      runAction("deny", () =>
                        onResolve(current.approvalId, "deny"),
                      )
                    }
                  />
                ) : current.kind === "device-code" ? (
                  <DeviceCodeActions
                    busy={isBusy}
                    pendingAction={pendingAction}
                    onCancel={() =>
                      runAction("dismiss", () =>
                        onResolve(current.approvalId, "dismiss"),
                      )
                    }
                  />
                ) : current.kind === "unit-install-review" ? (
                  <InstallReviewActions
                    approval={current}
                    allowNow={installAllowNow}
                    busy={isBusy}
                    pendingAction={pendingAction}
                    onAccept={() =>
                      runAction("once", () =>
                        onResolveInstallReview(
                          current.approvalId,
                          installAcceptanceFrom(current, installSelection),
                        ),
                      )
                    }
                    onCancel={() =>
                      runAction("dismiss", () =>
                        onResolveInstallReview(current.approvalId, {
                          decision: "cancel",
                        }),
                      )
                    }
                  />
                ) : current.kind === "browser-permission" ? (
                  <BrowserPermissionActions
                    approval={current}
                    busy={isBusy}
                    pendingAction={pendingAction}
                    onChoose={(decision) =>
                      runAction(decision, () =>
                        onResolve(current.approvalId, decision),
                      )
                    }
                  />
                ) : (
                  <StandardActions
                    approval={current}
                    busy={isBusy}
                    pendingAction={pendingAction}
                    onChoose={(decision) =>
                      runAction(decision, () =>
                        onResolve(current.approvalId, decision),
                      )
                    }
                  />
                )}
              </View>
            </Animated.View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </AppModal>
  );
}
