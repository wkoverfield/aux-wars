import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useSession } from "../../hooks/useSession";
import { usePendingAction } from "../../hooks/usePendingAction";
import { useToast } from "../../contexts/ToastContext";
import { captureGameEvent, hashRoomCode } from "../../services/analytics";
import { getVisitorId } from "../../utils/visitorId";
import { makeSeatKey } from "../quickplay/quickPlayModel";
import logo from "../../assets/aux-wars-logo.svg";
import { isPlaceholderName, joinGateCopy } from "./joinGateCopy";
import { joinSourceFrom } from "../screen/screenModel";

/**
 * Shown on a room URL to someone who is not in that room: the landing screen
 * of an invite link. Joining seats them and creates their session, after
 * which the route guard renders the room. Joining is a deliberate tap, never
 * automatic, so anything that merely opens the URL (a crawler, a link
 * preview) does not take a seat.
 *
 * @param {Object} props
 * @param {string} props.code - Room code from the URL
 * @param {Object} props.room - Public room state
 * @param {Array} props.players - Players in the room
 */
export default function JoinGate({ code, room, players }) {
  const navigate = useNavigate();
  // Joins from the big screen's QR code are counted as their own method.
  const source = joinSourceFrom(useLocation().search);
  const joinGame = useMutation(api.game.rooms.joinGame);
  const { session, connectionId, createSession } = useSession();
  const { showToast } = useToast();
  const { pending, run } = usePendingAction();
  // A returning player's last name is a better default than an empty box.
  const [name, setName] = useState(
    session?.playerName && !isPlaceholderName(session.playerName) ? session.playerName : ""
  );
  const [error, setError] = useState(null);
  const copy = joinGateCopy(room, players);

  const handleJoin = (e) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Enter a name to join.");
      return;
    }
    setError(null);
    run(async () => {
      const playerId = crypto.randomUUID();
      const visitorId = getVisitorId();
      try {
        const resp = await joinGame({
          code,
          name: trimmed,
          playerId,
          connectionId,
          // Player ids are visible to the whole room. A seat created with a
          // key can only be pointed at another connection by presenting it,
          // and nothing in a private room does, so the key is not kept.
          seatKey: makeSeatKey(),
          source,
          ...(visitorId && visitorId !== "anon" ? { visitorId } : {}),
        });
        if (!resp?.success) {
          setError(resp?.message || "Couldn't join this game.");
          return;
        }
        captureGameEvent("player_joined", {
          room_code_hash: hashRoomCode(code),
          took_over_connection: Boolean(resp.tookOver),
          join_source: source,
        });
        // Replaces any session for another room: this tab now plays here.
        createSession({ gameCode: code, playerId, playerName: trimmed, lastPhase: room.phase || "lobby" });
      } catch {
        showToast("Couldn't reach the game. Please try again.", "error");
      }
    });
  };

  return (
    <div data-vital="join" className="min-h-[100svh] w-full flex items-center justify-center p-5 text-white">
      <div className="w-full max-w-md flex flex-col gap-5">
        <div className="flex items-center gap-2">
          <img src={logo} alt="" className="w-10" />
          <p className="text-2xl">Aux Wars</p>
        </div>

        <div className="lobby-container rounded-md flex flex-col gap-2">
          <h1 className="text-2xl">{copy.title}</h1>
          <p className="text-sm text-gray-300">{copy.detail}</p>
        </div>

        {copy.canJoin ? (
          <form onSubmit={handleJoin} className="lobby-info flex flex-col gap-3" noValidate>
            <label className="text-xl" htmlFor="join-name">Your name</label>
            <input
              id="join-name"
              data-vital="name"
              type="text"
              className="w-full rounded-md"
              maxLength={50}
              autoComplete="nickname"
              autoFocus
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? "join-error" : undefined}
            />
            {error && (
              <p id="join-error" role="alert" className="text-sm text-[#ff2929]">{error}</p>
            )}
            <button
              type="submit"
              data-vital="join"
              disabled={pending}
              aria-busy={pending}
              className="green-btn rounded-full py-3 px-8 w-full font-semibold disabled:opacity-70"
            >
              {pending ? "Joining..." : "Join game"}
            </button>
          </form>
        ) : null}

        <button
          type="button"
          onClick={() => navigate("/", { replace: true })}
          className="text-sm text-gray-400 hover:text-white underline underline-offset-4 self-center"
        >
          {copy.canJoin ? "Not now, take me home" : "Go to the home page"}
        </button>
      </div>
    </div>
  );
}
