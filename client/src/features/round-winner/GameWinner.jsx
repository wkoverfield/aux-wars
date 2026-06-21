import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from 'convex/react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../../../../convex/_generated/api';
import { useSession } from '../../hooks/useSession';
import { useHeartbeat } from '../../hooks/useHeartbeat';
import PlayerResultWithHover from '../../components/PlayerResultWithHover';
import ScrollFade from '../../components/ScrollFade';
import AnimatedLogo from '../../components/AnimatedLogo';
import AdSlot from '../../components/AdSlot';
import { captureGameEvent, gameProperties } from '../../services/analytics';
import { computeAwards } from './computeAwards';

function buildPlayerStatsFromRounds(results) {
  const stats = {};
  const rounds = Array.isArray(results) ? results : Object.values(results || {});
  rounds.forEach((round, roundIdx) => {
    if (!round.songs) return;
    const winnerSongId = round.winnerSongId;
    round.songs.forEach((song) => {
      const playerId = song.player?.id;
      if (!playerId) return;
      if (!stats[playerId]) {
        stats[playerId] = { playerId, playerName: song.player.name, wins: 0, totalRecords: 0, songs: [] };
      }
      stats[playerId].songs.push({ ...song, round: roundIdx + 1, isRoundWinner: song.songId === winnerSongId });
      stats[playerId].totalRecords += song.totalRecords || 0;
      if (song.songId === winnerSongId) stats[playerId].wins += 1;
    });
  });
  return Object.values(stats);
}

/** Tiny deterministic PRNG (mulberry32) + string hash. Seeding the shuffle from a
 *  per-game value makes the superlative reel STABLE across re-renders, remounts,
 *  StrictMode double-mounts and reactive query pushes, while still varying
 *  game-to-game. (Math.random would reshuffle on every reactive re-render.) */
function hashStr(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i += 1) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return (h ^ (h >>> 16)) >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates pick of up to n items using a provided RNG (deterministic when seeded). */
function pickN(arr, n, rng = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

const SUSPENSE_MS = 1300;
const WINNER_MS = 2600;
const SUPERLATIVE_MS = 4000;

/** Shared "running it back in 3…2…1" overlay, driven off the room timestamp. */
function RematchCountdown({ rematchAt, onCancel }) {
  const [remaining, setRemaining] = useState(() => Math.max(0, Math.ceil((rematchAt - Date.now()) / 1000)));
  useEffect(() => {
    const tick = () => setRemaining(Math.max(0, Math.ceil((rematchAt - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [rematchAt]);
  return (
    <motion.div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm px-6 text-center"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    >
      <p className="text-white/70 text-lg mb-2">Running it back in…</p>
      <AnimatePresence mode="wait">
        <motion.div
          key={remaining}
          initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 1.5, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          className="text-7xl font-bold text-[#68d570]"
        >
          {remaining || 'Go!'}
        </motion.div>
      </AnimatePresence>
      <button
        onClick={onCancel}
        className="mt-8 py-2 px-5 rounded-full text-white/80 font-semibold bg-white/10 hover:bg-white/20 transition-all"
      >
        Cancel
      </button>
    </motion.div>
  );
}

/** Per-player setlist modal — their picks across the game with scores. */
function SetlistModal({ player, onClose }) {
  if (!player) return null;
  const songs = [...(player.songs || [])].sort((a, b) => a.round - b.round);
  return (
    <motion.div
      className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}
    >
      <motion.div
        className="bg-[#181818] rounded-lg w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden shadow-2xl"
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 px-5 pt-5 pb-3 flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-400">Setlist</p>
            <h3 className="text-xl font-bold text-[#68d570]">{player.playerName}</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl leading-none px-2">×</button>
        </div>
        <ScrollFade className="flex-1 min-h-0" contentClassName="px-5 pb-5 space-y-2" fadeColor="#181818" showTop={false}>
          {songs.map((s) => (
            <div key={`${s.round}-${s.songId}`} className="flex items-center gap-3 p-2 rounded-md bg-[#242424]">
              <span className="text-xs text-gray-500 w-5 shrink-0">R{s.round}</span>
              <img src={s.albumCover} alt="" className="w-11 h-11 rounded object-cover shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-white truncate">{s.name}{s.isRoundWinner ? ' 🏆' : ''}</p>
                <p className="text-xs text-gray-400 truncate">{s.artist}</p>
              </div>
              <span className="text-sm font-semibold text-gray-300 shrink-0">{s.totalRecords}</span>
            </div>
          ))}
        </ScrollFade>
      </motion.div>
    </motion.div>
  );
}

export default function GameWinner() {
  const { gameCode } = useParams();
  const navigate = useNavigate();

  const allRoundResultsQuery = useQuery(api.game.flow.getAllRoundResults, gameCode ? { code: gameCode } : 'skip');
  const playersQuery = useQuery(api.game.rooms.getPlayers, gameCode ? { code: gameCode } : 'skip');
  const voterAwardsQuery = useQuery(api.game.flow.getVoterAwards, gameCode ? { code: gameCode } : 'skip');
  const roomQuery = useQuery(api.game.rooms.getRoomByCode, gameCode ? { code: gameCode } : 'skip');
  const returnToLobbyMutation = useMutation(api.game.flow.returnToLobby);
  const startRematchMutation = useMutation(api.game.flow.startRematch);
  const cancelRematchMutation = useMutation(api.game.flow.cancelRematch);

  const { session, updateSession, clearSession } = useSession();
  const trackedRef = React.useRef(false);

  useHeartbeat(gameCode, session?.playerId, session?.connectionId, null, clearSession);

  const room = roomQuery?.room || roomQuery;
  const rematchAt = room?.rematchStartingAt || null;

  const sortedPlayers = useMemo(
    () => (allRoundResultsQuery
      ? buildPlayerStatsFromRounds(allRoundResultsQuery).sort((a, b) => b.wins - a.wins || b.totalRecords - a.totalRecords)
      : []),
    [allRoundResultsQuery]
  );

  const awards = useMemo(
    () => (allRoundResultsQuery && playersQuery
      ? computeAwards({ playerStats: sortedPlayers, allRounds: allRoundResultsQuery, voterAwards: voterAwardsQuery || [], players: playersQuery || [] })
      : []),
    [allRoundResultsQuery, playersQuery, voterAwardsQuery, sortedPlayers]
  );

  // Pick up to 3 superlatives to animate through after the winner. The pick is
  // DETERMINISTIC per game — seeded from this game's round winners — so it's the
  // identical reel on every render/remount. The heartbeat keeps re-pushing the
  // players query, StrictMode double-mounts, and Fast Refresh remounts all churn
  // refs; a Math.random pick (even frozen in a ref) leaks and reshuffles. Seeding
  // makes it immune: same finished game → same 3, fresh per game.
  const reelSeed = useMemo(() => {
    const sig = (allRoundResultsQuery || []).map((r) => r.winnerSongId || r.round).join('|');
    return hashStr(`${gameCode || ''}|${sig}`);
  }, [allRoundResultsQuery, gameCode]);
  const reel = useMemo(() => pickN(awards, 3, mulberry32(reelSeed)), [awards, reelSeed]);

  // Reveal flow: suspense → winner → superlatives (1 by 1) → final leaderboard.
  const [stage, setStage] = useState('suspense'); // 'suspense' | 'winner' | 'superlatives' | 'final'
  const [supIdx, setSupIdx] = useState(0);

  useEffect(() => {
    if (!sortedPlayers.length) return undefined;
    let t;
    if (stage === 'suspense') t = setTimeout(() => setStage('winner'), SUSPENSE_MS);
    else if (stage === 'winner') t = setTimeout(() => setStage(reel.length ? 'superlatives' : 'final'), WINNER_MS);
    else if (stage === 'superlatives') {
      t = setTimeout(() => {
        if (supIdx < reel.length - 1) setSupIdx((i) => i + 1);
        else setStage('final');
      }, SUPERLATIVE_MS);
    }
    return () => clearTimeout(t);
  }, [stage, supIdx, sortedPlayers.length, reel.length]);

  // Tap advances ONE step (Stories-style) so fast readers self-pace
  // instead of skipping the whole reveal in one tap.
  const advance = () => {
    if (stage === 'suspense') setStage('winner');
    else if (stage === 'winner') setStage(reel.length ? 'superlatives' : 'final');
    else if (stage === 'superlatives') {
      if (supIdx < reel.length - 1) setSupIdx(supIdx + 1);
      else setStage('final');
    }
  };

  const [setlistPlayer, setSetlistPlayer] = useState(null);

  // Analytics — game_completed_viewed (once).
  useEffect(() => {
    if (trackedRef.current || !sortedPlayers.length || !playersQuery) return;
    const top = sortedPlayers[0];
    trackedRef.current = true;
    captureGameEvent('game_completed_viewed', gameProperties({
      code: gameCode, players: playersQuery, session,
      extra: {
        rounds_total: (allRoundResultsQuery || []).length,
        player_count: sortedPlayers.length,
        winner_wins: top.wins,
        winner_records: top.totalRecords,
      },
    }));
  }, [sortedPlayers, playersQuery, gameCode, session, allRoundResultsQuery]);

  if (!allRoundResultsQuery || !playersQuery) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex flex-col items-center gap-4 text-white text-xl">
          <div className="w-16 h-16 border-4 border-[#1db954] border-t-transparent rounded-full animate-spin" />
          <p>Loading final results…</p>
        </div>
      </div>
    );
  }

  const winner = sortedPlayers[0];
  const rest = sortedPlayers.slice(1);
  const isFinal = stage === 'final';

  const handlePlayAgain = async () => {
    if (!session?.playerId || !session?.connectionId) return;
    captureGameEvent('play_again_clicked', gameProperties({ code: gameCode, players: playersQuery, session }));
    await startRematchMutation({ code: gameCode, playerId: session.playerId, connectionId: session.connectionId });
  };
  const handleBackToLobby = async () => {
    if (!session?.playerId || !session?.connectionId) return;
    captureGameEvent('return_to_lobby_clicked', gameProperties({ code: gameCode, players: playersQuery, session }));
    await returnToLobbyMutation({ code: gameCode, playerId: session.playerId, connectionId: session.connectionId });
    updateSession({ lastPhase: 'lobby' });
    navigate(`/lobby/${gameCode}`, { replace: true });
  };
  const handleCancelRematch = async () => {
    if (!session?.playerId || !session?.connectionId) return;
    await cancelRematchMutation({ code: gameCode, playerId: session.playerId, connectionId: session.connectionId });
  };

  return (
    <div className="relative h-full w-full overflow-hidden bg-transparent">
      {/* ---------- REVEAL (suspense → winner → superlatives) ---------- */}
      {!isFinal && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center px-4 cursor-pointer"
          onClick={advance}
        >
          <AnimatePresence mode="wait">
            {stage === 'suspense' && (
              <motion.p
                key="suspense" className="text-white/70 text-lg md:text-2xl text-center"
                initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.9 }}
              >
                Tonight’s best taste is…
              </motion.p>
            )}

            {stage === 'winner' && winner && (
              <motion.div
                key="winner" className="flex flex-col items-center"
                initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0, scale: 1.05 }}
                transition={{ type: 'spring', stiffness: 220, damping: 16 }}
              >
                <div className="text-4xl md:text-5xl mb-1">👑</div>
                <PlayerResultWithHover
                  playerName={winner.playerName} songs={winner.songs}
                  wins={winner.wins} totalRecords={winner.totalRecords} isWinner
                />
              </motion.div>
            )}

            {stage === 'superlatives' && reel[supIdx] && (
              <motion.div
                key={`sup-${supIdx}`} className="flex flex-col items-center text-center"
                initial={{ opacity: 0, scale: 0.8, y: 24 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 1.1, y: -24 }}
                transition={{ type: 'spring', stiffness: 200, damping: 18 }}
              >
                <div className="text-6xl md:text-7xl mb-4">{reel[supIdx].emoji}</div>
                <p className="text-white/55 text-xs md:text-sm uppercase tracking-[0.2em] mb-2">{reel[supIdx].title}</p>
                <p className="text-3xl md:text-4xl font-bold text-[#68d570] mb-2">{reel[supIdx].playerName}</p>
                <p className="text-white/70 text-sm md:text-base max-w-xs">{reel[supIdx].detail}</p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* progress dots while cycling superlatives */}
          {stage === 'superlatives' && reel.length > 1 && (
            <div className="absolute bottom-16 flex gap-2">
              {reel.map((_, i) => (
                <span key={i} className={`h-1.5 w-1.5 rounded-full ${i === supIdx ? 'bg-[#68d570]' : 'bg-white/25'}`} />
              ))}
            </div>
          )}

          <p className="absolute bottom-6 text-xs text-white/35">tap to continue</p>
        </div>
      )}

      {/* ---------- FINAL (full leaderboard) ---------- */}
      {isFinal && (
        <motion.div
          className="h-full w-full"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.4 }}
        >
          <ScrollFade className="h-full w-full" contentClassName="min-h-full flex flex-col items-center w-full max-w-2xl mx-auto px-2 py-4">
            <AnimatedLogo />

            {winner && (
              <div
                className="w-full flex flex-col items-center cursor-pointer mt-2"
                onClick={() => setSetlistPlayer(winner)}
              >
                <div className="text-3xl mb-1">👑</div>
                <PlayerResultWithHover
                  playerName={winner.playerName} songs={winner.songs}
                  wins={winner.wins} totalRecords={winner.totalRecords} isWinner
                />
              </div>
            )}

            <div className="w-full flex flex-col items-center gap-2 mt-2">
              {rest.map((player) => (
                <div
                  key={player.playerId}
                  className="w-full flex justify-center cursor-pointer"
                  onClick={() => setSetlistPlayer(player)}
                >
                  <PlayerResultWithHover
                    playerName={player.playerName} songs={player.songs}
                    wins={player.wins} totalRecords={player.totalRecords} isWinner={false}
                  />
                </div>
              ))}
            </div>

            <p className="text-xs text-white/40 mt-2">tap anyone to see their setlist</p>

            <AdSlot slot="gameover" className="max-w-2xl mx-auto mt-4" />

            {/* Buttons — pushed to the bottom when there's room, in-flow so they're always reachable */}
            <div className="w-full max-w-md flex gap-3 mt-auto pt-6">
              <button
                onClick={handleBackToLobby}
                className="flex-1 py-3 rounded-full font-semibold text-white bg-[#242424] hover:bg-[#2d2d2d] transition-all"
              >
                🚪 Back to Lobby
              </button>
              <button
                onClick={handlePlayAgain}
                className="flex-1 py-3 rounded-full font-bold text-black bg-[#68d570] hover:bg-[#7de884] transition-all"
              >
                🔄 Play Again
              </button>
            </div>
          </ScrollFade>
        </motion.div>
      )}

      <AnimatePresence>
        {setlistPlayer && <SetlistModal player={setlistPlayer} onClose={() => setSetlistPlayer(null)} />}
      </AnimatePresence>

      <AnimatePresence>
        {rematchAt && <RematchCountdown rematchAt={rematchAt} onCancel={handleCancelRematch} />}
      </AnimatePresence>
    </div>
  );
}
