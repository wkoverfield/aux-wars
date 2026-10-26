import { useCallback, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { phoneAudioKey, readSession, writeSession } from "./screenModel";

/**
 * Whether this phone plays the clip being rated. With a big screen attached
 * to the room the screen plays it, so phones stay quiet unless the player
 * turns "Play on this phone" on (remembered for the room in this tab).
 *
 * @param {string} code - Room code
 * @returns {{ screenAttached: boolean, playOnPhone: boolean, togglePlayOnPhone: Function }}
 */
export function usePhoneAudio(code) {
  const attached = useQuery(api.screens.screenAttached, code ? { code } : "skip") === true;
  const [playOnPhone, setPlayOnPhone] = useState(() => readSession(phoneAudioKey(code)) === "1");
  const togglePlayOnPhone = useCallback(() => {
    setPlayOnPhone((on) => {
      const next = !on;
      writeSession(phoneAudioKey(code), next ? "1" : null);
      return next;
    });
  }, [code]);
  return { screenAttached: attached, playOnPhone, togglePlayOnPhone };
}
