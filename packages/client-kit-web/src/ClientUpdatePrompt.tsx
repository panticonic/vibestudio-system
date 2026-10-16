/**
 * The client-update prompt over `@workspace/client-update-core`: which builds
 * are ready, apply or postpone each, and a plain account of any update that was
 * refused, rolled back or failed. The host decides how a build is taken (its
 * `ClientUpdatePort`); this only asks the person and says what happened.
 */
import { Button, Callout, Flex, Text } from "@radix-ui/themes";
import { ExclamationTriangleIcon, InfoCircledIcon } from "@radix-ui/react-icons";
import {
  clientUpdateMessage,
  type ClientUpdateModel,
  type ClientUpdateNoticeTone,
} from "@workspace/client-update-core";
import { useSnapshot } from "./useSnapshot";

const NOTICE_COLOR: Record<ClientUpdateNoticeTone, "blue" | "green" | "red"> = {
  info: "blue",
  success: "green",
  danger: "red",
};

export function ClientUpdatePrompt({ model }: { model: ClientUpdateModel }) {
  const { pending, notices, busy } = useSnapshot(model);
  if (pending.length === 0 && notices.length === 0) return null;
  return (
    <Flex direction="column" gap="2" className="client-update-prompt">
      {notices.map((notice) => (
        <Callout.Root key={notice.id} size="1" color={NOTICE_COLOR[notice.tone]} role="status">
          <Callout.Icon>
            {notice.tone === "danger" ? <ExclamationTriangleIcon /> : <InfoCircledIcon />}
          </Callout.Icon>
          <Callout.Text>
            <Flex as="span" align="center" justify="between" gap="2">
              <span>
                <strong>{notice.title}.</strong> {notice.message}
              </span>
              <Button
                size="1"
                variant="ghost"
                color="gray"
                onClick={() => model.dismissNotice(notice.id)}
              >
                Dismiss
              </Button>
            </Flex>
          </Callout.Text>
        </Callout.Root>
      ))}
      {pending.map((update) => (
        <Callout.Root key={update.clientId} size="1" color="blue">
          <Callout.Icon>
            <InfoCircledIcon />
          </Callout.Icon>
          <Callout.Text>
            <Flex as="span" align="center" justify="between" gap="2" wrap="wrap">
              <Text as="span" size="2">{clientUpdateMessage(update)}</Text>
              <Flex as="span" gap="2">
                <Button
                  size="1"
                  disabled={busy === update.clientId}
                  onClick={() => void model.apply(update.clientId).catch(() => undefined)}
                >
                  Apply update
                </Button>
                <Button
                  size="1"
                  variant="soft"
                  color="gray"
                  disabled={busy === update.clientId}
                  onClick={() => model.postpone(update.clientId)}
                >
                  Later
                </Button>
              </Flex>
            </Flex>
          </Callout.Text>
        </Callout.Root>
      ))}
    </Flex>
  );
}
