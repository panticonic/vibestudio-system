import { userFacingError } from "../utils/userFacingError";
import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  Callout,
  Flex,
  Select,
  Text,
  TextField,
} from "@radix-ui/themes";
import type { HubWorkspaceEntry } from "@vibestudio/service-schemas/hubControl";
import { useShellWorkspaceClient } from "../shell/workspaceContext";
import { workspaceLabel } from "../shell/workspaceLabel";
import type { hubControl } from "../shell/client";

type Roster = Awaited<ReturnType<typeof hubControl.listWorkspaceMembers>>;
type Change = {
  userId?: string;
  handle?: string;
  role?: "admin" | "member";
  removing?: boolean;
  label: string;
};

export function WorkspaceMembersSection({
  workspace,
  userId,
  onAccess,
}: {
  workspace: HubWorkspaceEntry;
  userId: string;
  onAccess?(workspaceId: string, canManage: boolean): void;
}) {
  const { hubControl } = useShellWorkspaceClient();
  const [roster, setRoster] = useState<Roster | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [handle, setHandle] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [review, setReview] = useState<Change | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    if (workspace.privateRole) return;
    let active = true;
    setLoadFailed(false);
    hubControl
      .listWorkspaceMembers({ workspace: workspace.name })
      .then((value) => {
        if (active) setRoster(value);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        setError(userFacingError(cause));
        setLoadFailed(true);
      });
    return () => {
      active = false;
    };
  }, [hubControl, workspace, loadAttempt]);
  const canManage =
    roster?.members.some(
      (member) => member.userId === userId && member.role === "admin",
    ) ?? false;
  useEffect(() => {
    if (roster) onAccess?.(workspace.workspaceId, canManage);
  }, [roster, workspace.workspaceId, canManage, onAccess]);
  const apply = async () => {
    if (!review) return;
    setBusy(true);
    setError(null);
    try {
      const target = {
        workspace: workspace.name,
        ...(review.userId
          ? { userId: review.userId }
          : { handle: review.handle! }),
      };
      if (review.removing) await hubControl.removeWorkspaceMember(target);
      else
        await hubControl.addWorkspaceMember({ ...target, role: review.role });
      setRoster(
        await hubControl.listWorkspaceMembers({ workspace: workspace.name }),
      );
      setReview(null);
      setHandle("");
    } catch (cause) {
      setError(userFacingError(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Flex
      direction="column"
      gap="3"
      pt="4"
      style={{ borderTop: "1px solid var(--gray-a5)" }}
    >
      <Text size="3" weight="bold">
        People in {workspaceLabel(workspace)}
      </Text>
      {workspace.privateRole ? (
        <Text size="2" color="gray">
          Only you. Your {workspaceLabel(workspace)} workspace cannot be shared.
        </Text>
      ) : (
        <>
          <Text size="2" color="gray">
            Members use this workspace together. Workspace admins also manage
            people and connection rules.
          </Text>
          {!roster && !loadFailed ? (
            <Text size="2" color="gray" role="status">
              Loading people…
            </Text>
          ) : null}
          {roster?.members.map((member) => (
            <Flex
              key={member.userId}
              align="center"
              justify="between"
              gap="3"
              wrap="wrap"
            >
              <Flex direction="column">
                <Text size="2" weight="medium">
                  {member.displayName ?? member.handle ?? member.userId}
                  {member.userId === userId ? " (you)" : ""}
                </Text>
                {member.displayName && member.handle ? (
                  <Text size="1" color="gray">
                    @{member.handle}
                  </Text>
                ) : null}
              </Flex>
              <Flex align="center" gap="2" wrap="wrap">
                <Badge color="gray">
                  {member.role === "admin" ? "Workspace admin" : "Member"}
                </Badge>
                {canManage && member.userId !== userId ? (
                  <>
                    <Button
                      size="1"
                      variant="soft"
                      disabled={busy}
                      onClick={() =>
                        setReview({
                          userId: member.userId,
                          role: member.role === "admin" ? "member" : "admin",
                          label:
                            member.displayName ??
                            member.handle ??
                            member.userId,
                        })
                      }
                    >
                      {member.role === "admin" ? "Make member" : "Make admin"}
                    </Button>
                    <Button
                      size="1"
                      variant="ghost"
                      color="red"
                      disabled={busy}
                      onClick={() =>
                        setReview({
                          userId: member.userId,
                          removing: true,
                          label:
                            member.displayName ??
                            member.handle ??
                            member.userId,
                        })
                      }
                    >
                      Remove
                    </Button>
                  </>
                ) : null}
              </Flex>
            </Flex>
          ))}
          {canManage ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (handle.trim())
                  setReview({
                    handle: handle.trim(),
                    role,
                    label: handle.trim(),
                  });
              }}
            >
              <Flex gap="2" wrap="wrap">
                <TextField.Root
                  aria-label="Account handle"
                  placeholder="Account handle"
                  value={handle}
                  onChange={(event) => setHandle(event.target.value)}
                  style={{ flex: "1 1 160px" }}
                />
                <Select.Root
                  value={role}
                  onValueChange={(value) =>
                    setRole(value as "admin" | "member")
                  }
                >
                  <Select.Trigger aria-label="Workspace role" />
                  <Select.Content>
                    <Select.Item value="member">Member</Select.Item>
                    <Select.Item value="admin">Workspace admin</Select.Item>
                  </Select.Content>
                </Select.Root>
                <Button type="submit" disabled={!handle.trim() || busy}>
                  Add person
                </Button>
              </Flex>
            </form>
          ) : null}
        </>
      )}
      {error ? (
        <Callout.Root color="red" role="alert">
          <Callout.Text>{error}</Callout.Text>
          {loadFailed ? (
            <Button
              size="1"
              variant="soft"
              mt="2"
              onClick={() => {
                setError(null);
                setLoadAttempt((attempt) => attempt + 1);
              }}
            >
              Retry
            </Button>
          ) : null}
        </Callout.Root>
      ) : null}
      {review ? (
        <Callout.Root role="region" aria-label="Review workspace membership">
          <Callout.Text>
            {review.removing
              ? `Remove ${review.label} from ${workspaceLabel(workspace)}? Their open sessions in this workspace will close.`
              : `Give ${review.label} ${review.role === "admin" ? "workspace admin" : "member"} access to ${workspaceLabel(workspace)}?`}
          </Callout.Text>
          <Flex gap="2" mt="3">
            <Button
              loading={busy}
              color={review.removing ? "red" : undefined}
              onClick={() => void apply()}
            >
              {review.removing ? "Remove person" : "Confirm access"}
            </Button>
            <Button
              variant="soft"
              disabled={busy}
              onClick={() => setReview(null)}
            >
              Cancel
            </Button>
          </Flex>
        </Callout.Root>
      ) : null}
    </Flex>
  );
}
