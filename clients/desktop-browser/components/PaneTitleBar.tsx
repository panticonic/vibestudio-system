import { TitleBar } from "./TitleBar";
import {
  useAncestors,
  useDescendantSiblingGroups,
  usePanelTree,
} from "../shell/hooks/PanelTreeContext";
import type { ComponentProps } from "react";

type Props = ComponentProps<typeof TitleBar> & {
  panelId: string;
  title: string;
};

export function PaneTitleBar({ panelId, title, ...props }: Props) {
  const { panelMap } = usePanelTree();
  const currentPanel = panelMap.get(panelId);
  const { ancestors } = useAncestors(panelId);
  const { groups } = useDescendantSiblingGroups(panelId);
  return (
    <TitleBar
      {...props}
      navigationData={{
        ancestors,
        current: {
          ...currentPanel,
          id: panelId,
          title: currentPanel?.title ?? title,
          childCount: currentPanel?.childCount ?? 0,
          position: 0,
        },
      }}
      statusNavigation={{ descendantGroups: groups, visiblePanelId: panelId }}
    />
  );
}
