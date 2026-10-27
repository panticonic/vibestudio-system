import { useCallback, useEffect, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { effectiveThemeAtom } from "../state/themeAtoms";
import { Box, Button, Callout, Flex, Text } from "@radix-ui/themes";
import type { BrowserDataSection as Section } from "@vibestudio/shared/shellSurface";
import type { HubWorkspaceEntry } from "@vibestudio/service-schemas/hubControl";
import { userFacingError } from "@workspace/client-kit-web/userFacingError";
import {
  useShellWorkspaceClient,
  useWorkspaceVisible,
} from "../shell/workspaceContext";
import { useShellEvent } from "../shell/useShellEvent";
import { desktopNativePanelBridge } from "../shell/nativePanelPresentation";

const sections: readonly { id: Section; label: string }[] = [
  { id: "passwords", label: "Passwords" },
  { id: "autofill", label: "Autofill" },
  { id: "siteData", label: "Site data" },
];

// The Settings tab owns one native slot. Join every admitted update and close
// in order, including a close while the host is still loading the document.
let surfaceOperation: Promise<unknown> = Promise.resolve();
function queueSurface(operation: () => Promise<unknown>): Promise<unknown> {
  const next = surfaceOperation.catch(() => undefined).then(operation);
  surfaceOperation = next;
  return next;
}

interface Props {
  workspaceId?: string;
  section: Section;
  onSectionChange?: (section: Section) => void;
  onWorkspaceResolved?: (workspaceId: string) => void;
}

/** Settings owns navigation and geometry; only the host view receives vault data. */
export function BrowserDataSection({
  workspaceId,
  section,
  onSectionChange,
  onWorkspaceResolved,
}: Props) {
  const { hubControl, view } = useShellWorkspaceClient();
  const visible = useWorkspaceVisible();
  const dark = useAtomValue(effectiveThemeAtom) === "dark";
  const [workspace, setWorkspace] = useState<HubWorkspaceEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const content = useRef<HTMLDivElement>(null);
  const sectionButtons = useRef<Array<HTMLButtonElement | null>>([]);
  const afterContent = useRef<HTMLSpanElement>(null);
  const selection = useRef(workspace);
  selection.current = workspace;
  const resolved = useRef(onWorkspaceResolved);
  resolved.current = onWorkspaceResolved;

  useEffect(() => {
    if (workspaceId && selection.current?.workspaceId === workspaceId) return;
    let active = true;
    setWorkspace(null);
    setError(null);
    void hubControl
      .listWorkspaces()
      .then(async (entries) => {
        if (!active) return;
        const selected = workspaceId
          ? entries.find((entry) => entry.workspaceId === workspaceId)
          : entries.find((entry) => entry.privateRole === "personal");
        if (!selected || selected.privateRole !== "personal") {
          throw new Error(
            "Browser data belongs to your Personal workspace. Open Personal to manage it.",
          );
        }
        // Ordinary workspace opening publishes its host services. Presentation
        // depends on that readiness, without changing the focused workspace.
        await desktopNativePanelBridge().openWorkspace(selected.workspaceId);
        if (!active) return;
        setWorkspace(selected);
        resolved.current?.(selected.workspaceId);
      })
      .catch((caught) => {
        if (active) setError(userFacingError(caught));
      });
    return () => {
      active = false;
    };
  }, [hubControl, workspaceId, attempt]);

  useShellEvent(
    "browser-data:focus-boundary",
    useCallback(
      ({ workspaceId: owner, backward }) => {
        if (owner !== workspace?.workspaceId) return;
        if (backward) sectionButtons.current.at(-1)?.focus();
        else afterContent.current?.focus();
      },
      [workspace?.workspaceId],
    ),
  );

  const present = useRef<(focus?: "first" | "last") => void>(() => undefined);
  const presentation = useRef({ section, dark });
  presentation.current = { section, dark };
  const selectedWorkspaceId = workspace?.workspaceId;
  useEffect(() => {
    const element = content.current;
    if (!selectedWorkspaceId || !visible || !element) return;
    let active = true;
    const update = (focus?: "first" | "last") => {
      const bounds = visibleBounds(element);
      void queueSurface(() =>
        view.setBrowserDataSurface(
          bounds
            ? {
                workspaceId: selectedWorkspaceId,
                ...presentation.current,
                bounds,
                ...(focus ? { focus } : {}),
              }
            : null,
        ),
      )
        .then(() => {
          if (active) setError(null);
        })
        .catch((caught) => {
          if (active) setError(userFacingError(caught));
        });
    };
    present.current = update;
    update();
    const resize = new ResizeObserver(() => update());
    resize.observe(element);
    const dialog = element.closest('[role="dialog"]');
    if (dialog) resize.observe(dialog);
    const geometryChanged = () => update();
    window.addEventListener("resize", geometryChanged);
    document.addEventListener("scroll", geometryChanged, true);
    return () => {
      active = false;
      present.current = () => undefined;
      resize.disconnect();
      window.removeEventListener("resize", geometryChanged);
      document.removeEventListener("scroll", geometryChanged, true);
      void queueSurface(() => view.setBrowserDataSurface(null)).catch(
        (caught) => {
          console.error("Could not close Browser data settings", caught);
        },
      );
    };
  }, [selectedWorkspaceId, visible, view]);
  useEffect(() => {
    present.current();
  }, [section, dark]);

  return (
    <Box pt="4">
      <Text as="p" size="2" color="gray" mb="3">
        Manage passwords, autofill and site sessions in{" "}
        {workspace?.displayName ?? "Personal"}.
      </Text>
      <Flex gap="2" mb="3" role="group" aria-label="Browser data sections">
        {sections.map((item, index) => (
          <Button
            key={item.id}
            ref={(button) => {
              sectionButtons.current[index] = button;
            }}
            variant={section === item.id ? "solid" : "soft"}
            aria-pressed={section === item.id}
            onClick={() => onSectionChange?.(item.id)}
          >
            {item.label}
          </Button>
        ))}
      </Flex>
      {error && (
        <Callout.Root color="red" role="alert" mb="3">
          <Callout.Text>{error}</Callout.Text>
          <Button
            variant="soft"
            onClick={() => {
              if (workspace) present.current();
              else setAttempt((value) => value + 1);
            }}
          >
            Try again
          </Button>
        </Callout.Root>
      )}
      {!workspace && !error && (
        <Text size="2" color="gray">
          Opening browser data…
        </Text>
      )}
      <span
        tabIndex={0}
        aria-label="Enter browser data"
        onFocus={() => present.current("first")}
      />
      <div
        ref={content}
        aria-label="Protected browser data"
        style={{
          height: "min(52vh, 480px)",
          minHeight: 220,
          position: "relative",
        }}
      />
      <span
        ref={afterContent}
        tabIndex={0}
        aria-label="Leave browser data"
        onKeyDown={(event) => {
          if (event.key === "Tab" && event.shiftKey) {
            event.preventDefault();
            present.current("last");
          }
        }}
      />
    </Box>
  );
}

/** Native children must obey the scrolling and clipping of the Settings dialog. */
function visibleBounds(
  element: HTMLElement,
): { x: number; y: number; width: number; height: number } | null {
  const rect = element.getBoundingClientRect();
  let left = Math.max(0, rect.left);
  let top = Math.max(0, rect.top);
  let right = Math.min(window.innerWidth, rect.right);
  let bottom = Math.min(window.innerHeight, rect.bottom);
  for (
    let parent = element.parentElement;
    parent;
    parent = parent.parentElement
  ) {
    const style = getComputedStyle(parent);
    if (
      !/(auto|scroll|hidden|clip)/.test(
        `${style.overflow} ${style.overflowX} ${style.overflowY}`,
      )
    )
      continue;
    const clip = parent.getBoundingClientRect();
    left = Math.max(left, clip.left);
    top = Math.max(top, clip.top);
    right = Math.min(right, clip.right);
    bottom = Math.min(bottom, clip.bottom);
  }
  if (right <= left || bottom <= top) return null;
  return {
    x: Math.round(left),
    y: Math.round(top),
    width: Math.round(right - left),
    height: Math.round(bottom - top),
  };
}
