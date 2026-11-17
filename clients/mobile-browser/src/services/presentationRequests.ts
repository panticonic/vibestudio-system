/** A presentation request addressed to a device (`panel-presentation-requested`). */
export interface MobilePresentationRequest {
  slotId: string;
  deviceId: string;
  focus: boolean;
  alert: "none" | "inbox" | "interrupt";
}

/**
 * Presentation requests for this phone (tendrils plan 4.5). Requests for other
 * devices are dropped. A request that arrives before the screen subscribes is
 * held, newest per slot, and handed over on subscribe; the screen taking the
 * slot is what clears it on the server, so a reconnect may deliver it again.
 */
export class PresentationRequestInbox {
  private readonly listeners = new Set<(request: MobilePresentationRequest) => void>();
  private unclaimed: MobilePresentationRequest[] = [];

  constructor(private readonly deviceId: () => string | null) {}

  receive(request: MobilePresentationRequest): void {
    if (!request.deviceId || request.deviceId !== this.deviceId()) return;
    if (this.listeners.size === 0) {
      this.unclaimed = [...this.unclaimed.filter((r) => r.slotId !== request.slotId), request];
      return;
    }
    for (const listener of this.listeners) listener(request);
  }

  subscribe(listener: (request: MobilePresentationRequest) => void): () => void {
    this.listeners.add(listener);
    const unclaimed = this.unclaimed;
    this.unclaimed = [];
    for (const request of unclaimed) listener(request);
    return () => {
      this.listeners.delete(listener);
    };
  }

  clear(): void {
    this.listeners.clear();
    this.unclaimed = [];
  }
}
