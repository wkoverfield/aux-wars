import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from 'convex/react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../../../../convex/_generated/api';
import { useSession } from '../../hooks/useSession';
import { useHeartbeat } from '../../hooks/useHeartbeat';
import { usePendingAction } from '../../hooks/usePendingAction';
import { useToast } from '../../contexts/ToastContext';
import PlayerResultWithHover from '../../components/PlayerResultWithHover';
import ScrollFade from '../../components/ScrollFade';
import AnimatedLogo from '../../components/AnimatedLogo';
import AdSlot from '../../components/AdSlot';
import { captureGameEvent, gameProperties } from '../../services/analytics';
import { computeAwards } from './computeAwards';
import { pickReel, reelSeedFor, standingsFrom, withNonSubmitters } from './resultsModel';
import SetlistModal from './SetlistModal';
import Standings from './Standings';
import { sendLink } from '../lobby/invite';
import { SecondsLeft, useSecondsUntil } from '../quickplay/useQuickPlay';

/**
 * Quick Play top bar: anyone can leave; the next game starts on its own.
 */
function PublicGameOverBar({ rematchAt, onLeave, leaving }) {
  return (
    <div className="absolute top-0 inset-x-0 z-30 pointer-events-none">
      <div className="w-full max-w-2xl mx-auto flex justify-between items-center px-3 pt-3 md:pt-6">
        <button
          type="button"
          onClick={onLeave}
          disabled={leaving}
          className="pointer-events-auto green-btn rounded-full py-2 px-4 font-semibold text-xs md:text-sm"
        >
          Leave
        </button>
        {typeof rematchAt === 'number' && (
          <div
            role="timer"
            className="flex items-center gap-1 py-1 px-3 md:py-2 md:px-4 rounded-md text-white font-semibold bg-[#242424] text-sm md:text-base tabular-nums"
          >
            Next game in <span className="text-[#68d570]"><SecondsLeft target={rematchAt} />s</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** Quick Play: seated during the rematch countdown, so this game was not theirs. */
function NextGameWait({ rematchAt }) {
  return (
    <div className="h-full w-full flex flex-col items-center justify-center px-6 text-center text-white">
      <AnimatedLogo />
      <p className="text-2xl md:text-3xl font-bold mt-2">You&rsquo;re in</p>
      <p className="text-gray-400 text-sm md:text-base mt-2 max-w-sm">
        This room is finishing a game. You&rsquo;ll play the next one
        {typeof rematchAt === 'number' ? <>, starting in <span className="text-[#68d570] font-semibold tabular-nums"><SecondsLeft target={rematchAt} />s</span>.</> : '.'}
      </p>
    </div>
  );
}

const SUSPENSE_MS = 1300;
const WINNER_MS = 2600;
const SUPERLATIVE_MS = 4000;

/** Shared "running it back in 3…2…1" overlay, driven off the room timestamp. */
function RematchCountdown({ rematchAt, onCancel, cancelling }) {
  const remaining = useSecondsUntil(rematchAt) ?? 0;
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
        disabled={cancelling}
        aria-busy={cancelling}
        className="mt-8 py-2 px-5 rounded-full text-white/80 font-semibold bg-white/10 hover:bg-white/20 transition-colors disabled:opacity-60"
      >
        {cancelling ? 'Cancelling...' : 'Cancel'}
      </button>
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

  // Quick Play rooms rematch on their own; no host buttons, no cancel.
  const isPublic = Boolean(room?.isPublic);
  const leaveGameMutation = useMutation(api.game.rooms.leaveGame);
  // Play Again and Back to Lobby share one action (only one can be in flight).
  const endAction = usePendingAction();
  const cancelAction = usePendingAction();
  const shareAction = usePendingAction();
  const shareResultsMutation = useMutation(api.results.share);
  const logEvent = useMutation(api.analytics.logEvent);
  const { showToast } = useToast();
  const [leaving, setLeaving] = useState(false);
  const publicRematchAt = isPublic && typeof rematchAt === 'number' ? rematchAt : null;
  const me = playersQuery?.find((p) => p.playerId === session?.playerId);
  const handleLeavePublic = async () => {
    if (leaving || !session?.playerId || !session?.connectionId) return;
    setLeaving(true);
    try {
      await leaveGameMutation({ code: gameCode, playerId: session.playerId, connectionId: session.connectionId });
    } finally {
      clearSession();
      navigate('/', { replace: true });
    }
  };

  const sortedPlayers = useMemo(
    () => (allRoundResultsQuery ? standingsFrom(allRoundResultsQuery) : []),
    [allRoundResultsQuery]
  );

  // The final list also names players who rated but never submitted a song.
  const everyone = useMemo(
    () => withNonSubmitters(sortedPlayers, voterAwardsQuery || [], playersQuery || []),
    [sortedPlayers, voterAwardsQuery, playersQuery]
  );

  // DETERMINISTIC per-game seed (from this game's round winners). Drives BOTH the
  // superlative reel pick and each award's copy variant, so a finished game always
  // looks identical across renders/remounts (the heartbeat re-pushes the players
  // query, StrictMode double-mounts, Fast Refresh remounts — all churn refs; a
  // Math.random pick leaks and reshuffles), while still varying game-to-game.
  const reelSeed = useMemo(() => reelSeedFor(gameCode, allRoundResultsQuery), [allRoundResultsQuery, gameCode]);

  const awards = useMemo(
    () => (allRoundResultsQuery && playersQuery
      ? computeAwards({ playerStats: sortedPlayers, allRounds: allRoundResultsQuery, voterAwards: voterAwardsQuery || [], players: playersQuery || [], seed: reelSeed })
      : []),
    [allRoundResultsQuery, playersQuery, voterAwardsQuery, sortedPlayers, reelSeed]
  );

  const reel = useMemo(() => pickReel(awards, reelSeed), [awards, reelSeed]);

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

  if (isPublic && me?.isWaiting) {
    return (
      <div className="relative h-full w-full overflow-hidden bg-transparent">
        <PublicGameOverBar rematchAt={publicRematchAt} onLeave={handleLeavePublic} leaving={leaving} />
        <NextGameWait rematchAt={publicRematchAt} />
      </div>
    );
  }

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
  const isFinal = stage === 'final';

  const creds = { code: gameCode, playerId: session?.playerId, connectionId: session?.connectionId };
  const hasCreds = Boolean(session?.playerId && session?.connectionId);
  const unreachable = () => showToast("Couldn't reach the game. Please try again.", 'error');

  const handlePlayAgain = () => {
    if (!hasCreds) return;
    endAction.run(async () => {
      captureGameEvent('play_again_clicked', gameProperties({ code: gameCode, players: playersQuery, session }));
      try {
        await startRematchMutation(creds);
      } catch {
        unreachable();
      }
    }, 'again');
  };
  const handleBackToLobby = () => {
    if (!hasCreds) return;
    endAction.run(async () => {
      try {
        await returnToLobbyMutation(creds);
      } catch {
        unreachable();
        return;
      }
      updateSession({ lastPhase: 'lobby' });
      navigate(`/lobby/${gameCode}`, { replace: true });
    }, 'lobby');
  };
  /**
   * Saves this game's results as a page anyone with the link can open, then
   * sends the link: the share sheet on a phone, the clipboard elsewhere.
   */
  const handleShareResults = () => {
    if (!hasCreds) return;
    shareAction.run(async () => {
      let res;
      try {
        res = await shareResultsMutation(creds);
      } catch {
        unreachable();
        return;
      }
      if (!res?.success) {
        showToast(res?.message || "Couldn't share these results.", 'warning');
        return;
      }
      const url = `${window.location.origin}/g/${res.shareId}`;
      const text = winner ? `${winner.playerName} won our Aux Wars game. Here's how it went:` : 'Our Aux Wars game. Here is how it went:';
      const outcome = await sendLink({ title: 'Aux Wars results', text, url });
      if (outcome === 'cancelled') return;
      if (outcome === 'failed') {
        showToast("Couldn't copy the link. Try again.", 'warning');
        return;
      }
      if (outcome === 'copied') showToast('Results link copied', 'success');
      logEvent({ eventType: 'result_shared' }).catch(() => {});
      captureGameEvent('result_shared', gameProperties({ code: gameCode, players: playersQuery, session, extra: { method: outcome === 'shared' ? 'share' : 'copy' } }));
    });
  };
  const handleCancelRematch = () => {
    if (!hasCreds) return;
    cancelAction.run(async () => {
      try {
        await cancelRematchMutation(creds);
      } catch {
        unreachable();
      }
    });
  };

  return (
    <div data-vital="game-over" className="relative h-full w-full overflow-hidden bg-transparent">
      {isPublic && <PublicGameOverBar rematchAt={publicRematchAt} onLeave={handleLeavePublic} leaving={leaving} />}

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
          <ScrollFade className="h-full w-full" contentClassName={`min-h-full flex flex-col items-center w-full max-w-2xl mx-auto px-2 ${isPublic ? 'pt-16 md:pt-20 pb-4' : 'py-4'}`}>
            <AnimatedLogo />

            <Standings players={everyone} awards={reel} onPickPlayer={setSetlistPlayer} />

            <p className="text-xs text-white/40 mt-3">tap anyone to see their setlist</p>

            {/* Quiet on purpose: one muted action, no prompt. */}
            <button
              type="button"
              data-vital="share-results"
              onClick={handleShareResults}
              disabled={shareAction.pending}
              aria-busy={shareAction.pending}
              className="mt-3 flex items-center gap-1.5 text-xs text-white/50 hover:text-white transition-colors disabled:opacity-60"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 8.25H7.5a2.25 2.25 0 0 0-2.25 2.25v9a2.25 2.25 0 0 0 2.25 2.25h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25H15m0-3-3-3m0 0-3 3m3-3V15" />
              </svg>
              {shareAction.pending ? 'Getting the link...' : 'Share these results'}
            </button>

            <AdSlot slot="gameover" className="max-w-2xl mx-auto mt-4" />

            {/* Buttons — pushed to the bottom when there's room, in-flow so they're always reachable */}
            {!isPublic && (
            <div className="w-full max-w-md flex gap-3 mt-auto pt-6">
              <button
                data-vital="back"
                onClick={handleBackToLobby}
                disabled={endAction.pending}
                aria-busy={endAction.pendingKey === 'lobby'}
                className="flex-1 py-3 rounded-full font-semibold text-white bg-[#242424] hover:bg-[#2d2d2d] transition-colors disabled:opacity-60"
              >
                {endAction.pendingKey === 'lobby' ? 'Heading back...' : '🚪 Back to Lobby'}
              </button>
              <button
                data-vital="again"
                onClick={handlePlayAgain}
                disabled={endAction.pending}
                aria-busy={endAction.pendingKey === 'again'}
                className="flex-1 py-3 rounded-full font-bold text-black bg-[#68d570] hover:bg-[#7de884] transition-colors disabled:opacity-60"
              >
                {endAction.pendingKey === 'again' ? 'Starting...' : '🔄 Play Again'}
              </button>
            </div>
            )}
          </ScrollFade>
        </motion.div>
      )}

      <AnimatePresence>
        {setlistPlayer && <SetlistModal player={setlistPlayer} onClose={() => setSetlistPlayer(null)} />}
      </AnimatePresence>

      <AnimatePresence>
        {rematchAt && !isPublic && <RematchCountdown rematchAt={rematchAt} onCancel={handleCancelRematch} cancelling={cancelAction.pending} />}
      </AnimatePresence>
    </div>
  );
}
