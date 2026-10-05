const REVEAL_PHASES = new Set(['rating', 'results', 'gameOver']);

/**
 * Which result queries to hold open so the reveal screens have data the
 * moment they mount: the current round's results from the rating phase on,
 * and on the final round also the whole-game results and voter awards.
 * Held through results/gameOver so the subscription is never dropped and
 * re-created across the route change. Args must match the screens' own
 * useQuery calls so the client shares one subscription.
 */
export function revealPrefetch(room) {
  if (!room || !REVEAL_PHASES.has(room.phase)) return { round: null, finalRound: false };
  const round = room.currentRound || 1;
  const numberOfRounds = room.settings?.numberOfRounds || 3;
  return {
    round: room.phase === 'gameOver' ? null : round,
    finalRound: round >= numberOfRounds,
  };
}
