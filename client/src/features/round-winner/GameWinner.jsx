import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from 'convex/react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../../../../convex/_generated/api';
import { useSession } from '../../hooks/useSession';
import { useHeartbeat } from '../../hooks/useHeartbeat';
import PlayerResultWithHover from '../../components/PlayerResultWithHover';
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

const KIND_STYLE = {
  glory: 'border-[#68d570]/40 bg-[#68d570]/10',
  roast: 'border-amber-400/30 bg-amber-400/5',
  judge: 'border-sky-400/30 bg-sky-400/5',
};

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
        className="bg-[#181818] rounded-lg w-full max-w-md max-h-[85vh] overflow-y-auto shadow-2xl"
        initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-[#181818] px-5 pt-5 pb-3 flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-400">Setlist</p>
            <h3 className="text-xl font-bold text-[#68d570]">{player.playerName}</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl leading-none px-2">×</button>
        </div>
        <div className="px-5 pb-5 space-y-2">
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
        </div>
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

  // Reveal stage machine: brief suspense → winner held → full standings/awards.
  const [stage, setStage] = useState('reveal'); // 'reveal' | 'full'
  useEffect(() => {
    if (!sortedPlayers.length) return undefined;
    const t = setTimeout(() => setStage('full'), 3200);
    return () => clearTimeout(t);
  }, [sortedPlayers.length]);

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
      <div className="flex items-center justify-center h-screen">
        <div className="flex flex-col items-center gap-4 text-white text-xl">
          <div className="w-16 h-16 border-4 border-[#1db954] border-t-transparent rounded-full animate-spin" />
          <p>Loading final results…</p>
        </div>
      </div>
    );
  }

  const winner = sortedPlayers[0];
  const rest = sortedPlayers.slice(1);
  const revealing = stage === 'reveal';

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
    <div className="relative flex flex-col h-screen w-full max-w-7xl mx-auto pt-2 pb-6 px-2 md:p-6 bg-transparent items-center overflow-hidden">
      <div className="flex justify-center w-full mb-2 md:mb-3 shrink-0">
        <AnimatedLogo />
      </div>

      {/* Tap anywhere to skip the reveal */}
      <div
        className="w-full flex-1 flex flex-col items-center overflow-y-auto"
        onClick={() => revealing && setStage('full')}
        style={{ minHeight: 0 }}
      >
        {/* Suspense headline (reveal only) */}
        <AnimatePresence>
          {revealing && (
            <motion.p
              key="suspense"
              className="text-white/70 text-base md:text-lg mt-2 mb-3"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            >
              Tonight’s best taste is…
            </motion.p>
          )}
        </AnimatePresence>

        {/* Winner */}
        {winner && (
          <motion.div
            className="w-full flex flex-col items-center cursor-pointer"
            initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 220, damping: 18, delay: revealing ? 0.6 : 0 }}
            onClick={(e) => { e.stopPropagation(); if (revealing) setStage('full'); else setSetlistPlayer(winner); }}
          >
            <div className="text-3xl md:text-4xl mb-1">👑</div>
            <PlayerResultWithHover
              playerName={winner.playerName}
              songs={winner.songs}
              wins={winner.wins}
              totalRecords={winner.totalRecords}
              isWinner
            />
          </motion.div>
        )}

        {/* Standings + awards (full only) */}
        <AnimatePresence>
          {!revealing && (
            <motion.div
              key="full"
              className="w-full flex flex-col items-center gap-2"
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
            >
              {rest.map((player) => (
                <div
                  key={player.playerId}
                  className="w-full flex justify-center cursor-pointer"
                  onClick={(e) => { e.stopPropagation(); setSetlistPlayer(player); }}
                >
                  <PlayerResultWithHover
                    playerName={player.playerName}
                    songs={player.songs}
                    wins={player.wins}
                    totalRecords={player.totalRecords}
                    isWinner={false}
                  />
                </div>
              ))}

              {sortedPlayers.length > 0 && (
                <p className="text-xs text-white/40 mt-1">tap anyone to see their setlist</p>
              )}

              {/* Awards */}
              {awards.length > 0 && (
                <div className="w-full max-w-2xl mt-4 px-2">
                  <h3 className="text-center text-white/80 font-bold mb-3">🏅 Superlatives</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {awards.map((a, i) => (
                      <motion.div
                        key={a.id}
                        className={`flex items-center gap-3 rounded-lg border p-3 ${KIND_STYLE[a.kind] || 'border-white/10 bg-white/5'}`}
                        initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3, delay: i * 0.07 }}
                      >
                        <span className="text-2xl shrink-0">{a.emoji}</span>
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-white leading-tight">{a.title}</p>
                          <p className="text-sm text-[#68d570] truncate">{a.playerName}</p>
                          <p className="text-xs text-white/50 truncate">{a.detail}</p>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}

              <AdSlot slot="gameover" className="max-w-2xl mx-auto mt-4" />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Buttons — everyone, once the reveal settles */}
      {!revealing && (
        <motion.div
          className="shrink-0 w-full max-w-md flex gap-3 pt-3"
          initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, delay: 0.2 }}
        >
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
