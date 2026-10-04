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

/** Re-sends the resume a little after mount, in case the close beacon of a reload lands late. */
const RESUME_RETRY_MS = 3000;

/**
 * Quick Play: a closed tab gives its seat up within seconds instead of
 * holding it through the presence grace. Listens for pagehide only: a hidden
 * tab (visibilitychange) keeps its seat and gets the server's grace period.
 *
 * The server releases the seat a few seconds after the beacon unless the page
 * comes back, so this also calls `resume` (quickPlay.resumeSeat) on mount
 * (a reload) and when the page is restored from the back/forward cache.
 */
export function useLeaveOnClose({ enabled, code, playerId, connectionId, resume }) {
  useEffect(() => {
    if (!enabled || !code || !playerId || !connectionId) return undefined;
    const convexUrl = import.meta.env.VITE_CONVEX_URL;
    const creds = { code, playerId, connectionId };
    const resumeSeat = () => {
      if (resume) Promise.resolve(resume(creds)).catch(() => {});
    };
    const onPageHide = () => {
      sendLeaveBeacon({ convexUrl, ...creds });
    };
    const onPageShow = (e) => {
      if (e.persisted) resumeSeat();
    };
    resumeSeat();
    const retry = setTimeout(resumeSeat, RESUME_RETRY_MS);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      clearTimeout(retry);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [enabled, code, playerId, connectionId, resume]);
}
