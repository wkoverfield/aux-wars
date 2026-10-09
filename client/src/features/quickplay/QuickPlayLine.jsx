import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { api } from "../../../../convex/_generated/api";
import { useSession } from "../../hooks/useSession";
import { useToast } from "../../contexts/ToastContext";
import { homeLineCopy, makeSeatKey } from "./quickPlayModel";

/**
 * Homepage line under Join / Host: one click seats the player in the open
 * Quick Play room closest to starting (or opens one) and goes to its waiting
 * screen. The server assigns a generated name; the player can edit it there.
 */
export default function QuickPlayLine({ visitorId }) {
  const waitingQuery = useQuery(api.quickPlay.waitingCount);
  const joinQuickPlay = useMutation(api.quickPlay.join);
  const navigate = useNavigate();
  const { session, connectionId, createSession, clearSession, isSessionValid } = useSession();
  const { showToast } = useToast();
  const [joining, setJoining] = useState(false);

  const waiting = waitingQuery?.waiting ?? 0;

  const join = async (playerId, seatKey) => {
    const res = await joinQuickPlay({ playerId, connectionId, seatKey, visitorId });
    if (!res?.success) return res;
    createSession({ gameCode: res.code, playerId, playerName: res.name, lastPhase: "lobby", seatKey });
    navigate(`/lobby/${res.code}`);
    return res;
  };

  const handleClick = async () => {
    if (joining) return;
    setJoining(true);
    try {
      // Back from a Quick Play room in this browser: take the same seat again.
      const resumable = session?.quickPlay && session.seatKey && session.playerId && isSessionValid();
      let res = resumable ? await join(session.playerId, session.seatKey) : null;
      if (!res?.success) {
        if (resumable) clearSession();
        res = await join(crypto.randomUUID(), makeSeatKey());
      }
      if (!res?.success) {
        showToast(res?.message || "Couldn't find a game. Please try again.", "error");
        setJoining(false);
      }
    } catch {
      showToast("Couldn't find a game. Please try again.", "error");
      setJoining(false);
    }
  };

  return (
    <button
      type="button"
      data-vital="quick-play"
      onClick={handleClick}
      disabled={joining}
      aria-live="polite"
      className="mt-5 text-sm text-[#68d570] hover:underline disabled:opacity-60 disabled:no-underline text-center px-4"
    >
      {homeLineCopy({ waiting, joining })}
    </button>
  );
}
