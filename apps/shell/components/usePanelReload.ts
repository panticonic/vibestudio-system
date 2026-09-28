import { useCallback, useEffect, useRef, useState } from "react";

/** Own the user command from preparation through readiness, including repeat clicks. */
export function usePanelReload(perform: (panelId: string) => Promise<unknown>) {
  const inFlight = useRef(new Map<string, Promise<unknown>>());
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const reload = useCallback(
    (panelId: string) => {
      const current = inFlight.current.get(panelId);
      if (current) return current;
      setPending((before) => new Set(before).add(panelId));
      const operation = Promise.resolve()
        .then(() => perform(panelId))
        .finally(() => {
          if (inFlight.current.get(panelId) !== operation) return;
          inFlight.current.delete(panelId);
          if (mounted.current)
            setPending((before) => {
              const next = new Set(before);
              next.delete(panelId);
              return next;
            });
        });
      inFlight.current.set(panelId, operation);
      return operation;
    },
    [perform],
  );
  return { reload, pending };
}
