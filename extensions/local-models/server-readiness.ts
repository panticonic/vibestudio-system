/** Readiness belongs to one actual llama.cpp process, not elapsed startup time. */
export class ServerReadiness {
  readonly ready: Promise<void>;
  private readonly controller = new AbortController();
  private resolve!: () => void;
  private reject!: (error: unknown) => void;
  private settled = false;
  private flight: Promise<void> | undefined;
  private announced = false;
  private outputTail = "";

  constructor(
    private readonly check: (signal: AbortSignal) => Promise<boolean>,
  ) {
    this.ready = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
    // A process may fail before anyone has demanded it; its consumer still gets
    // this exact rejection when it awaits readiness.
    void this.ready.catch(() => {});
  }

  start(): void {
    this.probe(false);
  }

  observe(line: string): void {
    // Pinned llama.cpp b10621 server.cpp emits this after setting HTTP is_ready.
    // The log is a cue only: authenticated HTTP readiness remains authoritative.
    this.outputTail = `${this.outputTail}${line}`.slice(-2048);
    if (!/\blistening on http:\/\/[^\s]+/.test(this.outputTail)) return;
    this.announced = true;
    this.probe(true);
  }

  fail(error: unknown): void {
    this.controller.abort(error);
    if (this.settled) return;
    this.settled = true;
    this.reject(error);
  }

  async join(): Promise<void> {
    await this.flight;
  }

  private probe(announced: boolean): void {
    if (this.settled || this.flight) return;
    const work = (async () => {
      try {
        const healthy = await this.check(this.controller.signal);
        if (this.settled) return;
        if (healthy) {
          this.settled = true;
          this.resolve();
        } else if (announced)
          this.fail(
            new Error(
              "llama.cpp announced readiness but authenticated health was not ready",
            ),
          );
      } catch (error) {
        // Before the actual startup announcement, connection refusal is normal.
        if (announced) this.fail(error);
      }
    })();
    this.flight = work;
    void work.then(() => {
      if (this.flight === work) this.flight = undefined;
      // A synchronous/native output callback may arrive during the initial probe.
      if (!announced && this.announced && !this.settled) this.probe(true);
    });
  }
}
