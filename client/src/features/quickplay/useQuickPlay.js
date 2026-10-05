import { useEffect, useState } from "react";
import { leaveBeaconBody, secondsUntil } from "./quickPlayModel";

/** Ticks land this long after a second boundary, so the new value has flipped. */
export const TICK_SLACK_MS = 15;

/**
 * Milliseconds from `nowMs` until just after the next whole-second boundary,
 * counted relative to `alignTo` (a deadline) or to the wall clock. A countdown
 * computed as ceil((deadline - now) / 1000) changes exactly on those
 * boundaries, so one tick per second shows each value for a full second.
 */
export function msUntilNextSecond(nowMs, alignTo = 0) {
  const rem = (((alignTo - nowMs) % 1000) + 1000) % 1000;
  return (rem === 0 ? 1000 : rem) + TICK_SLACK_MS;
}

/**
 * Current time, re-rendering once per second while `enabled`, aligned to
 * the second boundaries of `alignTo` (the deadline being counted down to).
 * Call it from the leaf component that displays the countdown so only that
 * component re-renders each second.
 */
export function useNow(enabled, alignTo) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return undefined;
    let id;
    const tick = () => {
      const t = Date.now();
      setNow(t);
      id = setTimeout(tick, msUntilNextSecond(t, typeof alignTo === "number" ? alignTo : 0));
    };
    tick();
    return () => clearTimeout(id);
  }, [enabled, alignTo]);
  return now;
}

/** Whole seconds left until `targetMs` (null when there is no target), ticking on its boundaries. */
export function useSecondsUntil(targetMs) {
  const active = typeof targetMs === "number" && Number.isFinite(targetMs);
  const now = useNow(active, targetMs);
  return active ? secondsUntil(targetMs, now) : null;
}

/** Leaf that renders the seconds left until `target`, so only it re-renders per tick. */
export function SecondsLeft({ target }) {
  return useSecondsUntil(target);
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
