import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { api } from "../../../../convex/_generated/api";
import { usePendingAction } from "../../hooks/usePendingAction";
import { useSession } from "../../hooks/useSession";
import { useHeartbeat } from "../../hooks/useHeartbeat";
import { useToast } from "../../contexts/ToastContext";
import { useRoom } from "../../services/RoomProvider";
import AdSlot from "../../components/AdSlot";
import SessionTakenOverModal from "../../components/SessionTakenOverModal";
import logo from "../../assets/aux-wars-logo.svg";
import { useNow } from "./useQuickPlay";
import {
  DEFAULT_QUICK_PLAY_CAP,
  kickTallyLabel,
  lobbyStatus,
  startNowLabel,
  tallyFor,
} from "./quickPlayModel";

const NAME_DEBOUNCE_MS = 500;

function Tag({ children }) {
  return (
    <span className="text-[11px] rounded-full px-2 py-0.5 bg-[#68d570]/15 text-[#68d570] whitespace-nowrap">
      {children}
    </span>
  );
}

/** Status card; owns the countdown tick so only it re-renders each second. */
function StatusCard({ count, cap, startsAt, armedAt }) {
  const counting = typeof startsAt === "number";
  const now = useNow(counting, startsAt);
  const status = lobbyStatus({ count, cap, startsAt, armedAt, nowMs: now });
  if (status.kind === "countdown") {
    return (
      <div className="lobby-container rounded-md flex flex-col gap-2">
        <p className="text-xs">{status.label}</p>
        <p className="text-2xl">
          <span className="text-[#68d570] font-bold tabular-nums">{status.seconds}s</span>
          <span className="text-base text-gray-300"> · {status.headline}</span>
        </p>
        <div
          className="h-1 bg-[#333] rounded-full overflow-hidden"
          role="progressbar"
          aria-label="Time until the game starts"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(status.progress * 100)}
        >
          <div
            className="h-full bg-[#68d570] rounded-full transition-[width] duration-1000 ease-linear"
            style={{ width: `${Math.round(status.progress * 100)}%` }}
          />
        </div>
        <p className="text-xs text-gray-400">{status.helper}</p>
      </div>
    );
  }
  return (
    <div className="lobby-container rounded-md flex flex-col gap-2">
      <p className="text-xs">{status.label}</p>
      <p className="text-2xl">{status.headline}</p>
      <p className="text-xs text-gray-400">{status.helper}</p>
    </div>
  );
}

function OneVOneCard({ accepted, busy, onAccept, onDecline }) {
  return (
    <div className="lobby-container rounded-md flex flex-col gap-3 border border-[#68d570]/60">
      <p className="text-2xl">Play 1v1 now?</p>
      <p className="text-xs text-gray-400">
        {accepted
          ? "You're in. Waiting for the other player to accept."
          : "It's just the two of you so far. It starts only if you both accept."}
      </p>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onAccept}
          disabled={accepted || busy}
          aria-pressed={accepted}
          className="green-btn rounded-full py-2 px-4 flex-1 font-semibold text-sm disabled:opacity-70"
        >
          {accepted ? "Accepted" : "Play 1v1"}
        </button>
        <button
          type="button"
          onClick={onDecline}
          disabled={busy}
          className="rounded-full py-2 px-4 flex-1 font-semibold text-sm border border-gray-500 text-white hover:border-white transition-colors disabled:opacity-70"
        >
          Keep waiting
        </button>
      </div>
    </div>
  );
}

function PlayerRow({ player, isMe, startVoted, wants1v1, tally, canKick, kickVoted, onKick }) {
  const tallyText = kickTallyLabel(tally);
  return (
    <div className="lobby-player rounded-md items-center gap-3">
      <div className="min-w-0">
        <p className="truncate">{player.name}</p>
        {tallyText && <p className="text-xs text-[#ff2929] mt-0.5">{tallyText}</p>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {startVoted && <Tag>Start now</Tag>}
        {wants1v1 && <Tag>Wants 1v1</Tag>}
        {isMe && <p className="text-xs text-gray-400">You</p>}
        {canKick && (
          <button
            type="button"
            onClick={onKick}
            disabled={kickVoted}
            aria-pressed={kickVoted}
            className={
              kickVoted
                ? "text-xs text-[#ff2929] border border-[#ff2929]/60 rounded px-2 py-1"
                : "text-xs text-gray-400 hover:text-white border border-gray-600 rounded px-2 py-1 transition-colors"
            }
          >
            {kickVoted ? "Voted" : "Vote kick"}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Waiting screen for a Quick Play room (the lobby of a public, hostless
 * room): editable generated name, status card that becomes the start
 * countdown, a unanimous "Start now" vote, the 1v1 offer, and the player list
 * with an anonymous kick vote. No settings, no host Start button.
 *
 * Mobile is one column. From md up the controls and the player list sit side
 * by side in a centered max-w-5xl frame.
 */
export default function PublicLobby() {
  const navigate = useNavigate();
  const { room, players } = useRoom();
  const { session, updateSession, clearSession } = useSession();
  const { showToast } = useToast();
  const code = room?.code;
  const playerId = session?.playerId;
  const connectionId = session?.connectionId;

  const updatePlayerName = useMutation(api.game.rooms.updatePlayerName);
  const leaveGame = useMutation(api.game.rooms.leaveGame);
  const voteStart = useMutation(api.quickPlay.voteStart);
  const respondOneVOne = useMutation(api.quickPlay.respondOneVOne);
  const voteKick = useMutation(api.quickPlay.voteKick);

  const me = players.find((p) => p.playerId === playerId);
  const [name, setName] = useState(session?.playerName || "");
  const [nameError, setNameError] = useState(null);
  const [showTakenOver, setShowTakenOver] = useState(false);
  // Kick votes are anonymous on the server, so this browser remembers its own.
  const [kickVotes, setKickVotes] = useState(() => new Set());
  const [leaving, setLeaving] = useState(false);

  useHeartbeat(code, playerId, connectionId, () => setShowTakenOver(true), clearSession);

  const edited = useRef(false);

  // Fill the field from the seat once it loads (e.g. after a rejoin).
  useEffect(() => {
    if (!edited.current && !name && me?.name) setName(me.name);
  }, [me?.name, name]);

  // Rename, debounced; only after the player edits the field.
  useEffect(() => {
    if (!edited.current || !code || !playerId || !connectionId) return undefined;
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError("Name must be between 1 and 50 characters");
      return undefined;
    }
    const timer = setTimeout(async () => {
      const resp = await updatePlayerName({ code, playerId, connectionId, name: trimmed });
      if (resp?.code === "OK") {
        setNameError(null);
        updateSession({ playerName: trimmed });
      } else if (resp?.code === "INVALID_NAME") {
        setNameError(resp.message);
      } else if (resp?.code === "CONNECTION_TAKEN_OVER") {
        setShowTakenOver(true);
      }
    }, NAME_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [name, code, playerId, connectionId, updatePlayerName, updateSession]);

  const count = players.length;
  const cap = room?.playerCap ?? DEFAULT_QUICK_PLAY_CAP;

  const startVotes = room?.startVotes ?? [];
  const oneVOneAccepts = room?.oneVOneAccepts ?? [];
  const startAction = usePendingAction();
  const oneVOneAction = usePendingAction();
  const kickAction = usePendingAction();
  const serverVotedStart = Boolean(me && startVotes.includes(me._id));
  const iVotedStart = startAction.pending ? startAction.pendingKey : serverVotedStart;
  // Count my own vote as it is shown, so the label agrees with the button.
  const startVoteCount = startVotes.length + (iVotedStart === serverVotedStart ? 0 : iVotedStart ? 1 : -1);
  const offerOpen = room?.oneVOneOffered === true && count === 2;
  const iAccepted1v1 = Boolean(me && oneVOneAccepts.includes(me._id)) || oneVOneAction.pendingKey === "accept";
  const canKick = count >= 3;

  const creds = { code, playerId, connectionId };
  const failed = (res) => {
    if (res && res.success === false) showToast(res.message || "Something went wrong", "error");
  };

  // Each vote shows on the tap and settles to the server's answer (a refused
  // or failed call reverts, with a toast).
  const sendAndReport = async (send) => {
    try {
      failed(await send());
    } catch {
      showToast("Couldn't reach the game. Try again.", "error");
    }
  };
  const handleStartNow = () => {
    const vote = !iVotedStart;
    startAction.run(() => sendAndReport(() => voteStart({ ...creds, vote })), vote);
  };
  const handleAccept = () =>
    oneVOneAction.run(() => sendAndReport(() => respondOneVOne({ ...creds, accept: true })), "accept");
  const handleDecline = () =>
    oneVOneAction.run(() => sendAndReport(() => respondOneVOne({ ...creds, accept: false })), "decline");
  const handleKick = (target) => {
    if (!window.confirm(`Vote to kick ${target.name}?`)) return;
    kickAction.run(async () => {
      try {
        const res = await voteKick({ ...creds, targetPlayerDocId: target._id });
        if (res?.success === false) {
          showToast(res.message || "Couldn't vote", "error");
          return;
        }
        setKickVotes((prev) => new Set(prev).add(target._id));
        if (res?.kicked) showToast(`${target.name} was removed`, "success");
      } catch {
        showToast("Couldn't reach the game. Try again.", "error");
      }
    }, target._id);
  };

  const handleLeave = async () => {
    if (leaving || !code || !playerId || !connectionId) return;
    setLeaving(true);
    try {
      await leaveGame({ code, playerId, connectionId });
    } finally {
      clearSession();
      navigate("/", { replace: true });
    }
  };

  return (
    <>
      <div className="player-lobby h-screen flex flex-col w-full text-white">
        <header className="flex justify-between items-center mt-10 md:mt-12 w-full max-w-5xl mx-auto p-5">
          <div className="flex items-center gap-2">
            <img src={logo} alt="Logo" className="min-w-10" />
            <h1 className="text-2xl">Quick Play</h1>
          </div>
          <motion.div whileHover={{ scale: 1.05 }} transition={{ type: "spring", stiffness: 300, damping: 15 }}>
            <button
              type="button"
              className="green-btn rounded-full py-2 px-4 font-semibold"
              onClick={handleLeave}
              disabled={leaving}
            >
              <span className="text-xs md:text-sm">Leave</span>
            </button>
          </motion.div>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto md:overflow-hidden">
          <div className="w-full max-w-5xl mx-auto px-5 py-4 grid gap-10 md:grid-cols-2 md:gap-10 lg:gap-16 md:h-full">
            {/* Controls */}
            <section className="lobby-info flex flex-col gap-5 min-w-0" aria-label="Your seat">
              <label className="text-xl" htmlFor="qp-name">Your name</label>
              <div className="flex flex-col gap-1">
                <input
                  id="qp-name"
                  type="text"
                  className="w-full rounded-md"
                  maxLength={50}
                  value={name}
                  onChange={(e) => {
                    edited.current = true;
                    setName(e.target.value);
                  }}
                  aria-invalid={Boolean(nameError)}
                  aria-describedby={nameError ? "qp-name-error" : undefined}
                />
                {nameError && (
                  <p id="qp-name-error" className="text-xs text-[#ff2929]">{nameError}</p>
                )}
              </div>

              {offerOpen ? (
                <OneVOneCard accepted={iAccepted1v1} busy={oneVOneAction.pending} onAccept={handleAccept} onDecline={handleDecline} />
              ) : (
                <StatusCard count={count} cap={cap} startsAt={room?.startsAt} armedAt={room?.countdownArmedAt} />
              )}

              {count >= 2 && !offerOpen && (
                <motion.div whileHover={{ scale: 1.02 }} transition={{ type: "spring", stiffness: 300, damping: 15 }}>
                  <button
                    type="button"
                    onClick={handleStartNow}
                    aria-pressed={iVotedStart}
                    className={
                      iVotedStart
                        ? "rounded-full py-2 px-8 w-full font-semibold border border-[#68d570] text-[#68d570] bg-[#68d570]/10"
                        : "rounded-full py-2 px-8 w-full font-semibold border border-white/30 text-white bg-transparent hover:bg-white/10"
                    }
                  >
                    <span className="text-sm md:text-base">
                      {startNowLabel({ votes: startVoteCount, total: count, voted: iVotedStart })}
                    </span>
                  </button>
                </motion.div>
              )}
            </section>

            {/* Players */}
            <section className="flex flex-col gap-5 min-w-0 md:min-h-0" aria-label="Players">
              <div className="flex items-baseline justify-between">
                <h2 className="text-2xl">Players</h2>
                <p className="text-sm text-gray-400 tabular-nums">{count}/{cap}</p>
              </div>
              <div className="lobby-players md:flex-1 md:min-h-0 md:overflow-y-auto pb-4">
                {players.map((p) => (
                  <PlayerRow
                    key={p._id}
                    player={p}
                    isMe={p._id === me?._id}
                    startVoted={p._id === me?._id ? iVotedStart : startVotes.includes(p._id)}
                    wants1v1={offerOpen && oneVOneAccepts.includes(p._id)}
                    tally={tallyFor(room?.kickTallies, p._id)}
                    canKick={canKick && p._id !== me?._id}
                    kickVoted={kickVotes.has(p._id) || kickAction.pendingKey === p._id}
                    onKick={() => handleKick(p)}
                  />
                ))}
                <AdSlot slot="lobby" />
              </div>
            </section>
          </div>
        </div>

      </div>
      <SessionTakenOverModal show={showTakenOver} gameCode={code} />
    </>
  );
}
