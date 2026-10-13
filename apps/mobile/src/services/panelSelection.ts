export interface PanelSelectionReceipt {
  panelId: string;
  revision: number;
}

/** Authoritative panel focus that survives the gap before a screen subscribes. */
export class PanelSelectionState {
  private current: PanelSelectionReceipt | null = null;
  private revision = 0;
  private readonly listeners = new Set<
    (selection: PanelSelectionReceipt) => void
  >();

  select(panelId: string): PanelSelectionReceipt {
    const selection = { panelId, revision: ++this.revision };
    this.current = selection;
    for (const listener of this.listeners) listener(selection);
    return selection;
  }

  subscribe(listener: (selection: PanelSelectionReceipt) => void): () => void {
    this.listeners.add(listener);
    if (this.current) listener(this.current);
    return () => this.listeners.delete(listener);
  }

  clear(): void {
    this.current = null;
    this.listeners.clear();
  }
}
