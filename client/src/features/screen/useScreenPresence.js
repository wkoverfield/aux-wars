import { useEffect, useRef } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { screenIdFor, screenLeaveBeaconBody } from "./screenModel";

/** Heartbeat interval; the server times a screen out after a few missed beats. */
export const SCREEN_HEARTBEAT_MS = 20_000;

/**
 * Marks this tab as a big screen attached to `code` while `enabled`: a
 * heartbeat right away, every SCREEN_HEARTBEAT_MS, and again whenever the
 * page comes back (back/forward cache restore, tab visible again); a leave
 * when it is disabled or unmounted, and a best-effort leave beacon when the
 * page goes away. Never joins the room or takes a seat.
 *
 * Only enable it once the screen can play sound (after the start tap):
 * while a screen is attached, phones stay quiet and songs are held for it.
 *
 * @param {string} code - Room code
 * @param {boolean} enabled - The room exists and the screen has been started
 */
export function useScreenPresence(code, enabled) {
  const heartbeat = useMutation(api.screens.heartbeat);
  const leave = useMutation(api.screens.leave);
  const screenIdRef = useRef(null);
  if (!screenIdRef.current) {
    try {
      screenIdRef.current = screenIdFor();
    } catch {
      screenIdRef.current = `screen-${Math.random().toString(36).slice(2)}`;
    }
  }

  useEffect(() => {
    if (!enabled || !code) return undefined;
    const screenId = screenIdRef.current;
    const beat = () => {
      heartbeat({ code, screenId }).catch(() => {});
    };
    beat();
    const id = setInterval(beat, SCREEN_HEARTBEAT_MS);

    const onVisible = () => {
      if (document.visibilityState === "visible") beat();
    };
    // A reload fires pagehide too; the next mount's heartbeat re-attaches.
    const onPageHide = () => {
      const convexUrl = import.meta.env.VITE_CONVEX_URL;
      const body = screenLeaveBeaconBody({ code, screenId });
      const sent = convexUrl && navigator.sendBeacon
        ? navigator.sendBeacon(`${convexUrl}/api/mutation`, new Blob([body], { type: "application/json" }))
        : false;
      if (!sent) leave({ code, screenId }).catch(() => {});
    };
    window.addEventListener("pageshow", beat);
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      window.removeEventListener("pageshow", beat);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVisible);
      leave({ code, screenId }).catch(() => {});
    };
  }, [code, enabled, heartbeat, leave]);
}
