import { useCallback, useRef, useState } from 'react';

/**
 * Runs one async action at a time and reports it as pending from the tap
 * until it settles, so a button can show its pressed state on the next frame
 * instead of after the server round trip. A Convex mutation's promise resolves
 * once the query results that include its write have arrived, so clearing the
 * pending state then hands over to server truth without a flicker, and a
 * refused or failed call simply reverts.
 *
 * Taps while an action is in flight are ignored (no double submits).
 * `run(action, key)` records `key` (e.g. the target player's id) so a list of
 * buttons can tell which one is pending.
 */
export function usePendingAction() {
  const [pendingKey, setPendingKey] = useState(null);
  const inFlight = useRef(false);

  const run = useCallback(async (action, key = true) => {
    if (inFlight.current) return undefined;
    inFlight.current = true;
    setPendingKey(key);
    try {
      return await action();
    } finally {
      inFlight.current = false;
      setPendingKey(null);
    }
  }, []);

  return { pending: pendingKey !== null, pendingKey, run };
}
