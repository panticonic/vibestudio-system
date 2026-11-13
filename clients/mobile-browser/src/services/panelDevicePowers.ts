import type { HapticKind } from "@vibestudio/rn-client-api/devicePowersProtocol";

/** The host's `device-powers` surface (`clientApi().devicePowers`). */
export interface DevicePowersHost {
  granted(): boolean;
  setKeepAwake(on: boolean): Promise<void>;
  haptic(kind: HapticKind): Promise<void>;
  speak(request: { text: string; lang?: string }): Promise<void>;
  stopSpeaking(): Promise<void>;
}

/**
 * What panels reach through `__vibestudioShell.device` (tendrils plan 4.8).
 *
 * A panel asks for the screen to stay on; the screen stays on only while a
 * panel that asked is the one being shown. Speech from a panel that is no
 * longer shown is stopped. Every call fails plainly when the host does not
 * grant `device-powers`, and pages fall back to web APIs.
 */
export class PanelDevicePowers {
  private readonly wantAwake = new Set<string>();
  private visiblePanelId: string | null = null;
  private applied = false;
  private speakingPanelId: string | null = null;

  constructor(private readonly host: DevicePowersHost) {}

  capabilities(): string[] {
    return this.host.granted() ? ["keepAwake", "haptic", "speak"] : [];
  }

  async keepAwake(panelId: string, on: boolean): Promise<void> {
    this.require();
    if (on) this.wantAwake.add(panelId);
    else this.wantAwake.delete(panelId);
    await this.converge();
  }

  async haptic(kind: HapticKind): Promise<void> {
    this.require();
    await this.host.haptic(kind);
  }

  async speak(panelId: string, request: { text: string; lang?: string }): Promise<void> {
    this.require();
    this.speakingPanelId = panelId;
    try {
      await this.host.speak(request);
    } finally {
      if (this.speakingPanelId === panelId) this.speakingPanelId = null;
    }
  }

  async stopSpeaking(): Promise<void> {
    this.require();
    await this.host.stopSpeaking();
  }

  /** The shell shows `panelId` now (null: no panel is shown). */
  async setVisiblePanel(panelId: string | null): Promise<void> {
    this.visiblePanelId = panelId;
    if (this.speakingPanelId && this.speakingPanelId !== panelId && this.host.granted()) {
      this.speakingPanelId = null;
      await this.host.stopSpeaking();
    }
    await this.converge();
  }

  /** A panel's page went away; it no longer asks for anything. */
  async releasePanel(panelId: string): Promise<void> {
    this.wantAwake.delete(panelId);
    await this.converge();
  }

  /** Only these panels still have a page; the rest no longer ask for anything. */
  async retainOnly(panelIds: ReadonlySet<string>): Promise<void> {
    for (const panelId of [...this.wantAwake])
      if (!panelIds.has(panelId)) this.wantAwake.delete(panelId);
    await this.converge();
  }

  private require(): void {
    if (!this.host.granted())
      throw new Error("This device does not offer device powers to pages");
  }

  private async converge(): Promise<void> {
    const on = this.visiblePanelId !== null && this.wantAwake.has(this.visiblePanelId);
    if (on === this.applied || !this.host.granted()) return;
    this.applied = on;
    await this.host.setKeepAwake(on);
  }
}
