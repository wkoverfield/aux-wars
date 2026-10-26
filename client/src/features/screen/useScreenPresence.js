import { useEffect, useRef } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { captureGameEvent, hashRoomCode } from "../../services/analytics";
import { claimScreenOpened, screenIdFor, screenLeaveBeaconBody } from "./screenModel";

/** Heartbeat interval. Presence is swept server-side well after this lapses. */
export const SCREEN_HEARTBEAT_MS = 45_000;

/**
 * Marks this tab as a big screen attached to `code` while it is open: a
 * heartbeat on mount and every SCREEN_HEARTBEAT_MS, a best-effort leave when
 * the page goes away, and one screen_opened event per screen per room.
 * Never joins the room or takes a seat.
 *
 * @param {string} code - Room code
 * @param {boolean} enabled - Only once the room is known to exist
 */
export function useScreenPresence(code, enabled) {
  const heartbeat = useMutation(api.screens.heartbeat);
  const leave = useMutation(api.screens.leave);
  const logEvent = useMutation(api.analytics.logEvent);
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

    // A reload fires pagehide too; the next mount's heartbeat re-attaches.
    const onPageHide = () => {
      const convexUrl = import.meta.env.VITE_CONVEX_URL;
      const body = screenLeaveBeaconBody({ code, screenId });
      const sent = convexUrl && navigator.sendBeacon
        ? navigator.sendBeacon(`${convexUrl}/api/mutation`, new Blob([body], { type: "application/json" }))
        : false;
      if (!sent) leave({ code, screenId }).catch(() => {});
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      clearInterval(id);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [code, enabled, heartbeat, leave]);

  useEffect(() => {
    if (!enabled || !code) return;
    if (!claimScreenOpened(code)) return;
    logEvent({ eventType: "screen_opened", metadata: { roomCode: code } }).catch(() => {});
    captureGameEvent("screen_opened", { room_code_hash: hashRoomCode(code) });
  }, [code, enabled, logEvent]);
}
