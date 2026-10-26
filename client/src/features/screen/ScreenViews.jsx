import { memo, useEffect, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { motion } from "framer-motion";
import { api } from "../../../../convex/_generated/api";
import TrackPlayer from "../../components/TrackPlayer";
import PlayerBox from "../../components/PlayerBox";
import recordLogo from "../../components/record-logo.svg";
import { fallBackToOriginal, largeCoverArt } from "../../utils/coverArt";
import { useSecondsUntil } from "../quickplay/useQuickPlay";
import { pickStatus, ratingVotes, screenJoinUrl, submitterLabel } from "./screenModel";

/** The site's host as people type it: no "www.". */
function siteLabel() {
  return typeof window === "undefined" ? "aux-wars.com" : window.location.host.replace(/^www\./, "");
}

/** Renders the QR code for `url` (the QR library loads on demand). */
function useQrDataUrl(url) {
  const [state, setState] = useState({ src: null, failed: false });
  useEffect(() => {
    let cancelled = false;
    import("qrcode")
      .then((qr) => qr.toDataURL(url, { margin: 2, width: 640, errorCorrectionLevel: "M" }))
      .then((src) => {
        if (!cancelled) setState({ src, failed: false });
      })
      .catch(() => {
        if (!cancelled) setState({ src: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [url]);
  return state;
}

/** Quiet corner tag so someone arriving mid-game can still join. */
export function ScreenJoinTag({ code }) {
  return (
    <p className="absolute top-6 right-8 z-30 text-lg text-white/50">
      Join at {siteLabel()} · <span className="font-semibold text-white/80 tracking-wider">{code}</span>
    </p>
  );
}

/** "The prompt is:" with the prompt, sized for across the room. */
function ScreenPromptCard({ prompt, size = "lg" }) {
  return (
    <div className="w-full">
      <p className={`text-gray-400 mb-3 ${size === "lg" ? "text-2xl" : "text-lg"}`}>The prompt is:</p>
      <div className={`bg-[#242424] rounded-xl ${size === "lg" ? "px-10 py-8" : "px-6 py-4"}`}>
        <p className={`font-bold text-white leading-snug ${size === "lg" ? "text-5xl" : "text-2xl"}`}>
          &quot;{prompt}&quot;
        </p>
      </div>
    </div>
  );
}

/** Round dots, one per player, filled for the ones who are done. */
function ProgressDots({ done, total }) {
  return (
    <div className="flex gap-3">
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`h-4 w-4 rounded-full transition-all duration-300 ${i < done ? "bg-[#68d570]" : "bg-[#414141]"}`}
        />
      ))}
    </div>
  );
}

/** Countdown pill for a deadline, matching the phones' timer. */
function CountdownPill({ deadline }) {
  const left = useSecondsUntil(deadline);
  if (left === null) return null;
  const mins = Math.floor(left / 60);
  const secs = String(left % 60).padStart(2, "0");
  return (
    <div
      className={`px-6 py-3 rounded-full font-bold text-3xl tabular-nums ${
        left <= 10 ? "bg-red-600 text-white" : "bg-[#242424] text-white"
      }`}
    >
      {mins}:{secs}
    </div>
  );
}

/**
 * Lobby: the room code and a QR for everyone in the room to join on their
 * own phone, and the players as they arrive.
 */
export function ScreenLobby({ code, room, players }) {
  const qr = useQrDataUrl(screenJoinUrl(code));
  const cap = room?.settings?.hostPro ? 50 : 8;
  const seated = players.filter((p) => !p.isWaiting);
  return (
    <div data-vital="screen-lobby" className="h-full w-full flex gap-14 px-16 py-14 text-white">
      <div className="flex-1 min-w-0 flex flex-col">
        <p className="text-2xl text-gray-400">Join at {siteLabel()} with the code</p>
        <p className="text-[140px] leading-none font-bold tracking-[0.08em] mt-3">{code}</p>
        <div className="flex items-baseline justify-between mt-10 mb-4">
          <p className="text-3xl">Players</p>
          <p className="text-2xl text-gray-400 tabular-nums">{seated.length}/{cap}</p>
        </div>
        <div className="grid grid-cols-2 gap-3 text-xl content-start overflow-hidden flex-1 min-h-0">
          {seated.map((p) => (
            <PlayerBox
              key={p.playerId || p._id}
              playerId={p.playerId}
              name={p.name}
              isPlayerHost={!!p.isHost}
              isReady={!!p.isReady}
              canKick={false}
            />
          ))}
        </div>
        <p className="text-2xl text-white/50 mt-4">Waiting for the host to start.</p>
      </div>
      <div className="w-[400px] shrink-0 flex flex-col items-center justify-center gap-5">
        <div className="w-[400px] h-[400px] rounded-xl bg-white flex items-center justify-center">
          {qr.src ? (
            <img src={qr.src} alt="QR code to join this game" className="w-full h-full rounded-xl" />
          ) : qr.failed ? (
            <p className="text-xl text-black text-center px-8">Join with the code instead.</p>
          ) : (
            <span role="status" className="h-12 w-12 rounded-full border-4 border-[#242424] border-t-transparent animate-spin">
              <span className="sr-only">Making the code...</span>
            </span>
          )}
        </div>
        <p className="text-2xl text-gray-300">Scan to join</p>
      </div>
    </div>
  );
}

/** Prompt voting: the prompt, the skip votes, and the clock. */
export function ScreenPrompt({ code, room }) {
  const status = useQuery(api.game.flow.getPromptVotingStatus, code ? { code } : "skip");
  // The query reports whole seconds left; turn that into a local deadline.
  const [deadline, setDeadline] = useState(null);
  const seconds = status?.timeRemaining;
  const prompt = status?.currentPrompt || room?.currentPrompt || "";
  useEffect(() => {
    if (typeof seconds === "number") setDeadline(Date.now() + seconds * 1000);
  }, [seconds, prompt]);
  const skipVotes = status?.skipVotes || 0;
  const needed = status?.majorityNeeded || 1;
  return (
    <div data-vital="screen-prompt" className="h-full w-full flex flex-col items-center justify-center gap-12 px-24 text-white">
      {deadline && <CountdownPill deadline={deadline} />}
      <motion.div key={prompt} className="w-full" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <ScreenPromptCard prompt={prompt} />
      </motion.div>
      <div className="flex flex-col items-center gap-3">
        <p className="text-2xl text-gray-400">Not feeling it? Vote to skip on your phone.</p>
        <div className="flex items-center gap-4 text-xl text-gray-400 tabular-nums">
          <span>{skipVotes}/{needed} votes to skip</span>
          <div className="w-64 h-3 bg-[#242424] rounded-full overflow-hidden">
            <div className="h-full bg-[#68d570] transition-all duration-300" style={{ width: `${Math.min(1, skipVotes / needed) * 100}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Song selection: the prompt and who has picked. Never which songs. */
export function ScreenSelection({ room, players }) {
  const { picked, waiting } = pickStatus(players, room?.currentRound);
  const total = picked.length + waiting.length;
  const roundLength = room?.settings?.roundLength || 0;
  const deadline = room?.selectionStartedAt && roundLength > 0 ? room.selectionStartedAt + roundLength * 1000 : undefined;
  return (
    <div data-vital="screen-selection" className="h-full w-full flex flex-col justify-center gap-12 px-24 text-white">
      <div className="flex items-center justify-between">
        <p className="text-2xl text-gray-400">Round {room?.currentRound || 1} of {room?.settings?.numberOfRounds || 3}</p>
        {deadline && <CountdownPill deadline={deadline} />}
      </div>
      <ScreenPromptCard prompt={room?.currentPrompt || ""} />
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-6">
          <p className="text-3xl tabular-nums">{picked.length} of {total} picked</p>
          <ProgressDots done={picked.length} total={total} />
        </div>
        <div className="flex flex-wrap gap-3 text-2xl">
          {picked.map((p) => (
            <span key={p.playerId} className="rounded-full bg-[#242424] px-5 py-2 text-white">
              <span className="text-[#68d570] mr-2" aria-hidden="true">✓</span>{p.name}
            </span>
          ))}
          {waiting.map((p) => (
            <span key={p.playerId} className="rounded-full border border-[#414141] px-5 py-2 text-white/45">
              {p.name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The song being rated: plays out loud here, with its art or video and a
 * progress bar. Give it a `key` per song (and per audio state) to reset it.
 */
const ScreenClip = memo(function ScreenClip({ song, audioOn }) {
  const playerRef = useRef(null);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const videoId = song?.videoId;
  const startTime = song?.snippet?.startTime ?? 0;
  const endTime = song?.snippet?.endTime ?? 0;

  // If the browser still refused to start the song, offer a tap.
  useEffect(() => {
    if (!audioOn || duration <= 0 || playing) {
      setBlocked(false);
      return undefined;
    }
    const t = setTimeout(() => setBlocked(true), 3000);
    return () => clearTimeout(t);
  }, [audioOn, duration, playing]);

  const progress = duration > 0 ? Math.min(1, time / duration) : 0;
  return (
    <div className="flex flex-col gap-5 w-full">
      <div className="relative">
        {!videoId && song?.albumCover && (
          <img
            src={largeCoverArt(song.albumCover)}
            onError={fallBackToOriginal(song.albumCover)}
            alt={`${song.name} album art`}
            className="w-[420px] h-[420px] rounded-xl object-cover shadow-lg mx-auto"
          />
        )}
        <div className={videoId ? "w-full" : "hidden"}>
          <TrackPlayer
            ref={playerRef}
            videoId={videoId}
            src={song?.previewUrl}
            startTime={startTime}
            endTime={endTime}
            autoPlay={audioOn}
            loop
            showControls={false}
            onReady={(d) => setDuration(d)}
            onTimeUpdate={setTime}
            onPlayingChange={setPlaying}
          />
        </div>
        {blocked && (
          <button
            type="button"
            onClick={() => playerRef.current?.play?.()}
            className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-xl text-2xl font-semibold text-white"
          >
            Tap to play the song
          </button>
        )}
      </div>
      {duration > 0 && (
        <div className="h-2 w-full rounded-full bg-[#333] overflow-hidden">
          <div className="h-full bg-[#68d570] transition-[width] duration-300 ease-linear" style={{ width: `${progress * 100}%` }} />
        </div>
      )}
    </div>
  );
});

/** Rating: the song playing out loud, who picked it (unless anonymous), and the votes. */
export function ScreenRating({ code, room, song, audioOn }) {
  const status = useQuery(api.game.flow.getCurrentRatingStatus, code ? { code } : "skip");
  const submissions = useQuery(api.game.flow.getSubmissionStatus, code ? { code } : "skip");
  const votes = ratingVotes(status);
  const by = submitterLabel(song, room?.settings?.anonymousMode);
  const index = room?.currentRatingIndex ?? 0;
  const totalSongs = submissions?.submitted || submissions?.total || 0;
  return (
    <div data-vital="screen-rating" className="h-full w-full flex items-center gap-14 px-16 pt-16 pb-12 text-white">
      <div className={`${song?.videoId ? "w-[620px]" : "w-[440px]"} shrink-0`}>
        <ScreenClip key={`${song?.songId}:${audioOn}`} song={song} audioOn={audioOn} />
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-8">
        <ScreenPromptCard prompt={room?.currentPrompt || ""} size="sm" />
        <div className="flex flex-col gap-2 min-w-0">
          <p className="text-xl text-gray-400">Song {index + 1}{totalSongs ? ` of ${totalSongs}` : ""}</p>
          <p className="text-5xl font-bold leading-tight line-clamp-2">{song?.name}</p>
          <p className="text-3xl text-gray-300 truncate">{song?.artist}</p>
          {by && <p className="text-2xl text-gray-400 mt-1 truncate">Picked by {by}</p>}
        </div>
        <div className="flex items-center gap-6">
          <p className="text-2xl tabular-nums">{votes.submitted} of {votes.total} voted</p>
          <ProgressDots done={votes.submitted} total={votes.total} />
        </div>
      </div>
    </div>
  );
}

/** The rating phase before its song arrives, or while the last one is totaled. */
export function ScreenTallying() {
  return (
    <div role="status" className="h-full w-full flex flex-col items-center justify-center gap-5 text-white">
      <div className="h-16 w-16 rounded-full border-[6px] border-white/15 border-t-[#68d570] animate-spin" aria-hidden="true" />
      <p className="text-3xl font-semibold">Tallying...</p>
    </div>
  );
}

/** Round result: the winning song big, the rest ranked beside it. */
export function ScreenResults({ code, room }) {
  const round = room?.currentRound || 1;
  const results = useQuery(api.game.flow.getRoundResults, code ? { code, round } : "skip");
  const songs = results?.songs || [];
  const [winner, ...rest] = songs;
  const isFinal = round >= (room?.settings?.numberOfRounds || 3);
  return (
    <div data-vital="screen-results" className="h-full w-full flex flex-col px-16 pt-16 pb-10 text-white">
      <p className="text-2xl text-gray-400">
        Round {round} results{room?.currentPrompt ? <> · <span className="text-white/70">&quot;{room.currentPrompt}&quot;</span></> : null}
      </p>
      {!winner ? (
        <ScreenTallying />
      ) : (
        <div className="flex-1 min-h-0 flex gap-14 mt-8">
          <motion.div
            className="w-[400px] shrink-0 flex flex-col items-center text-center"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            <div className="relative">
              <img
                src={largeCoverArt(winner.albumCover)}
                onError={fallBackToOriginal(winner.albumCover)}
                alt="Album Cover"
                className="w-[300px] h-[300px] rounded-xl shadow-lg object-cover"
              />
              <div className="absolute -top-7 -right-7 flex items-center bg-[#191414] bg-opacity-90 rounded-2xl px-3 py-1 shadow-lg">
                <img src={recordLogo} alt="Record" className="w-14 h-14 mr-1" />
                <span className="text-4xl font-bold">x{winner.totalRecords}</span>
              </div>
            </div>
            <p className="text-4xl font-bold mt-6 text-[#68d570] truncate max-w-full">{winner.player?.name}</p>
            <p className="text-2xl mt-1 truncate max-w-full">{winner.name}</p>
            <p className="text-xl text-gray-300 truncate max-w-full">{winner.artist}</p>
          </motion.div>
          <div className="flex-1 min-w-0 flex flex-col gap-3 overflow-hidden">
            {rest.map((s, i) => (
              <motion.div
                key={s.songId || i}
                className="flex items-center gap-5 rounded-lg bg-[#242424]/85 px-4 py-3"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.4, delay: 0.5 + i * 0.1 }}
              >
                <img src={s.albumCover} alt="Album Cover" className="w-16 h-16 rounded-md object-cover shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-2xl font-bold truncate">{s.player?.name}</p>
                  <p className="text-lg text-gray-300 truncate">{s.name} · {s.artist}</p>
                </div>
                <div className="flex items-center shrink-0">
                  <img src={recordLogo} alt="Record Logo" className="w-12 h-12 mr-1" />
                  <span className="text-3xl font-bold tabular-nums">{s.totalRecords}</span>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}
      <p className="text-xl text-white/50 mt-4">
        {isFinal ? "Waiting for the host to show the final results." : "Waiting for the host to start the next round."}
      </p>
    </div>
  );
}
