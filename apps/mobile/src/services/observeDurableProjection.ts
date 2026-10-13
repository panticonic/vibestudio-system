/**
 * Observe remote durable state without a read-before-listen gap or a stale
 * in-flight read overwriting a later change notification.
 */
export function observeDurableProjection<T>(input: {
  listen(changed: () => Promise<void>): () => void;
  admit?(): Promise<void>;
  leave?(): Promise<void>;
  read(): Promise<T>;
  apply(value: T): void;
  error(error: unknown): void;
}): { ready: Promise<void>; refresh(): Promise<void>; stop(): void } {
  let active = true;
  let admitted = input.admit === undefined;
  let requested = 0;
  let settled = 0;
  let running: Promise<void> | null = null;
  const receipts = new Map<
    number,
    { resolve(): void; reject(error: unknown): void }
  >();

  const settleThrough = (generation: number, error?: unknown) => {
    settled = generation;
    for (const [target, receipt] of receipts) {
      if (target > generation) continue;
      receipts.delete(target);
      if (error === undefined) receipt.resolve();
      else receipt.reject(error);
    }
  };

  const drain = async () => {
    while (active && settled !== requested) {
      const generation = requested;
      try {
        const value = await input.read();
        if (!active) return;
        if (generation !== requested) continue;
        input.apply(value);
        settleThrough(generation);
      } catch (error) {
        if (!active) return;
        if (generation !== requested) continue;
        input.error(error);
        settleThrough(generation, error);
      }
    }
  };
  const startDrain = () => {
    if (running) return;
    running = drain().finally(() => {
      running = null;
      if (active && settled !== requested) startDrain();
    });
  };
  const refresh = (): Promise<void> => {
    requested += 1;
    const generation = requested;
    const receipt = new Promise<void>((resolve, reject) => {
      receipts.set(generation, { resolve, reject });
    });
    // Direct event dispatchers intentionally ignore listener return values.
    // Attach an observer here while preserving rejection for recovery owners
    // that await the returned receipt.
    void receipt.catch(() => undefined);
    if (admitted) startDrain();
    return receipt;
  };

  const unlisten = input.listen(refresh);
  const ready = input.admit
    ? input.admit().then(
        async () => {
          if (!active) {
            await input.leave?.();
            return;
          }
          admitted = true;
          await refresh();
        },
        (error: unknown) => {
          if (active) {
            input.error(error);
            settleThrough(requested, error);
          }
          throw error;
        },
      )
    : refresh();
  void ready.catch(() => undefined);
  return {
    ready,
    refresh,
    stop: () => {
      active = false;
      for (const receipt of receipts.values()) receipt.resolve();
      receipts.clear();
      unlisten();
      if (admitted && input.leave) {
        void input.leave().catch(input.error);
      }
    },
  };
}
