export type TreeMoveKey = "ArrowUp" | "ArrowDown" | "Home" | "End";

/** Find a panel in the complete row model, including rows outside the virtual viewport. */
export function panelTreeKeyboardTarget(
  panelIdsByRow: readonly (string | null)[],
  currentId: string,
  key: TreeMoveKey,
): number | null {
  const panelIndexes = panelIdsByRow.flatMap((id, index) =>
    id ? [index] : [],
  );
  if (!panelIndexes.length) return null;
  const current = panelIndexes.findIndex(
    (index) => panelIdsByRow[index] === currentId,
  );
  const position =
    key === "Home"
      ? 0
      : key === "End"
        ? panelIndexes.length - 1
        : key === "ArrowUp"
          ? Math.max(0, current - 1)
          : Math.min(panelIndexes.length - 1, current + 1);
  return panelIndexes[position] ?? null;
}
