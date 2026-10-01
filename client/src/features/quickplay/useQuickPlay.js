import { useEffect, useState } from "react";
import { leaveBeaconBody } from "./quickPlayModel";

/**
 * Current time, re-rendering every `intervalMs` while `enabled`. Drives the
 * countdowns, which read server fire times (startsAt, autoAdvanceAt,
 * rematchStartingAt) and tick locally.
 */
export function useNow(enabled, intervalMs = 250) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [enabled, intervalMs]);
  return now;
}

/** POSTs the leave beacon. Returns false when there is nowhere to send it. */
export function sendLeaveBeacon({ convexUrl, code, playerId, connectionId, nav = globalThis.navigator }) {
  if (!convexUrl || !code || !playerId || !connectionId || !nav?.sendBeacon) return false;
  const blob = new Blob([leaveBeaconBody({ code, playerId, connectionId })], { type: "application/json" });
  return nav.sendBeacon(`${convexUrl}/api/mutation`, blob);
}

/**
 * Quick Play: a closed tab gives its seat up right away instead of holding it
 * through the presence grace. Listens for pagehide only: a hidden tab
 * (visibilitychange) keeps its seat and gets the server's grace period.
 */
export function useLeaveOnClose({ enabled, code, playerId, connectionId }) {
  useEffect(() => {
    if (!enabled || !code || !playerId || !connectionId) return undefined;
    const convexUrl = import.meta.env.VITE_CONVEX_URL;
    const onPageHide = () => {
      sendLeaveBeacon({ convexUrl, code, playerId, connectionId });
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [enabled, code, playerId, connectionId]);
}
