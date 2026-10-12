/**
 * Pure helpers for a finished game's results, shared by the final screen and
 * the shared results page so both show the same standings and awards.
 */
export function buildPlayerStatsFromRounds(results) {
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
      stats[playerId].songs.push({ ...song, round: roundIdx + 1, isRoundWinner: song.songId === winnerSongId, prompt: round.prompt });
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
export function hashStr(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i += 1) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return (h ^ (h >>> 16)) >>> 0;
}
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher–Yates pick of up to n items using a provided RNG (deterministic when seeded). */
export function pickN(arr, n, rng = Math.random) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}

/**
 * The reel seed for a game: its room code and round winners. The server
 * derives the same value for a shared snapshot (reelSeed in convex/results.ts,
 * same algorithm), so a shared page picks the awards the players saw.
 */
export function reelSeedFor(code, rounds) {
  const sig = (rounds || []).map((r) => r.winnerSongId || r.round).join('|');
  return hashStr(`${code || ''}|${sig}`);
}

/** Players best first: most round wins, then most records. */
export function standingsFrom(rounds) {
  return buildPlayerStatsFromRounds(rounds).sort((a, b) => b.wins - a.wins || b.totalRecords - a.totalRecords);
}

/** The awards shown for a game: up to three, picked deterministically from its seed. */
export function pickReel(awards, seed) {
  return pickN(awards, 3, mulberry32(seed));
}

/** "3 players, 2 rounds" for the line under the headline. */
export function recapSummary(playerCount, roundCount) {
  const players = `${playerCount} ${playerCount === 1 ? 'player' : 'players'}`;
  const rounds = `${roundCount} ${roundCount === 1 ? 'round' : 'rounds'}`;
  return `${players}, ${rounds}`;
}
