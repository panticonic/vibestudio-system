/**
 * One calm, persistent availability banner over `@workspace/connection-core`.
 * The host supplies a `ConnectionPort` (how it learns the state and how it
 * recovers); this owns nothing else: the core decides the notice, when a blip
 * is long enough to show, and which recovery the notice offers.
 */
import { useEffect, useMemo, useState } from "react";
import { Button, Flex, Spinner, Text } from "@radix-ui/themes";
import { CrossCircledIcon, ReloadIcon } from "@radix-ui/react-icons";
import {
  createConnectionModel,
  createOutageGate,
  type ConnectionPort,
} from "@workspace/connection-core";
import { useSnapshot } from "./useSnapshot";
import { userFacingError } from "./userFacingError";

export function ConnectionNotice({
  port,
  onOpenSettings,
}: {
  port: ConnectionPort;
  onOpenSettings: () => void;
}) {
  const model = useMemo(() => createConnectionModel(port), [port]);
  useEffect(() => model.start(), [model]);
  const { state, notice, recovering, recoveryError } = useSnapshot(model);

  const [visible, setVisible] = useState(false);
  const gate = useMemo(() => createOutageGate(setVisible), []);
  useEffect(() => () => gate.dispose(), [gate]);
  const phase = state?.phase ?? "starting";
  useEffect(() => gate.phase(phase), [gate, phase]);

  if (!visible || !notice) return null;
  const terminal = notice.final;
  return (
    <div
      className="workspace-connection-notice"
      data-terminal={terminal}
      role={terminal ? "alert" : "status"}
      aria-live={terminal ? "assertive" : "polite"}
      aria-label={notice.title}
    >
      {notice.showSpinner ? (
        <Spinner size="2" />
      ) : (
        <CrossCircledIcon width="18" height="18" color="var(--red-9)" />
      )}
      <div className="workspace-connection-notice-copy">
        <Text size="2" weight="bold">
          {notice.title}
        </Text>
        <Text className="workspace-connection-notice-message" size="2" color="gray">
          {notice.message}
        </Text>
        {notice.retryDetail ? (
          <Text size="1" color="gray">
            {notice.retryDetail}
          </Text>
        ) : null}
        {recoveryError !== undefined ? (
          <Text className="workspace-connection-notice-error" size="2">
            {userFacingError(recoveryError)}
          </Text>
        ) : null}
      </div>
      <Flex className="workspace-connection-notice-actions" gap="2">
        <Button
          size="1"
          variant="soft"
          disabled={recovering}
          onClick={() => void model.recover().catch(() => undefined)}
        >
          <ReloadIcon /> {terminal ? "Restart Vibestudio" : "Retry now"}
        </Button>
        {notice.showSettings ? (
          <Button size="1" variant="ghost" onClick={onOpenSettings}>
            Connection settings
          </Button>
        ) : null}
      </Flex>
    </div>
  );
}
