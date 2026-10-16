/** Bounded user timings for the operations that own shell presentation. */
const retained = new Set<string>();
const MAX_RETAINED_PHASES = 64;

export async function measureShellPhase<T>(
  phase: string,
  scope: string,
  operation: () => T | Promise<T>
): Promise<T> {
  const startedAt = performance.now();
  let outcome = "failed";
  try {
    const result = await operation();
    outcome = "complete";
    return result;
  } finally {
    const name = `shell:${phase}:${scope}`;
    performance.clearMeasures(name);
    performance.measure(name, {
      start: startedAt,
      end: performance.now(),
      detail: { phase, scope, outcome },
    });
    retained.delete(name);
    retained.add(name);
    while (retained.size > MAX_RETAINED_PHASES) {
      const oldest = retained.values().next().value;
      if (oldest === undefined) break;
      retained.delete(oldest);
      performance.clearMeasures(oldest);
    }
  }
}
