/**
 * Pure award computation for the end-game recap.
 *
 * Inputs (all already fetched by GameWinner):
 *  - playerStats: per-player rollup from buildPlayerStatsFromRounds()
 *      [{ playerId, playerName, wins, totalRecords, songs:[{songId,totalRecords,round,player,...}] }]
 *      (sorted best-first, so playerStats[0] is the game winner)
 *  - allRounds: api.game.flow.getAllRoundResults → [{ round, winnerSongId, songs:[...] }]
 *  - voterAwards: api.game.flow.getVoterAwards → [{ voterId, avgGiven, count, kingmakerHits }]
 *  - players: api.game.rooms.getPlayers → [{ playerId, name }]  (for voterId → name)
 *
 * Returns the award cards that meaningfully apply. Thresholds guard tiny games;
 * a player can earn more than one (that's part of the fun). "Best Taste" (the
 * winner) is intentionally NOT here — it's the reveal headline, shown separately.
 */

const MIN_ROUNDS_FOR_CONSISTENCY = 3; // Read the Room / NPC / One-Hit Wonder
const MIN_VOTERS_FOR_JUDGE = 3; // need a real panel for judge awards
const MIN_VOTES_FOR_JUDGE = 3; // a voter needs enough votes to count

function nameMap(players = []) {
  const m = new Map();
  for (const p of players) m.set(p.playerId, p.name);
  return m;
}

function variance(nums) {
  if (nums.length < 2) return 0;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  return nums.reduce((a, b) => a + (b - mean) ** 2, 0) / nums.length;
}

// FNV-1a string hash — used to give each award its own deterministic offset.
function fnv(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/**
 * Pick one copy variant deterministically: the same finished game always shows
 * the same line, but it varies game-to-game (and per award), so back-to-back
 * games don't repeat the exact phrasing. `seed` is the per-game seed from
 * GameWinner; `salt` is the award id so different awards rotate independently.
 */
function variant(arr, seed, salt) {
  return arr[(((seed >>> 0) ^ fnv(salt)) >>> 0) % arr.length];
}

export function computeAwards({ playerStats = [], allRounds = [], voterAwards = [], players = [], seed = 0 }) {
  const names = nameMap(players);
  const awards = [];
  const numRounds = allRounds.length;

  // Flatten every song across all rounds.
  const songs = [];
  for (const r of allRounds) {
    for (const s of r.songs || []) songs.push({ ...s, round: r.round });
  }
  if (songs.length === 0) return awards;

  const nameFor = (pid, fallback) => fallback || names.get(pid) || "—";
  const winner = playerStats[0];
  const winnerId = winner?.playerId;
  const distinctPlayers = new Set(songs.map((s) => s.playerId)).size;

  // ---------- GLORY ----------
  // 🔥 Crowd Favorite — single highest-scoring song
  const top = songs.reduce((a, b) => (b.totalRecords > a.totalRecords ? b : a), songs[0]);
  awards.push({
    id: "crowd_favorite", emoji: "🔥", kind: "glory", title: "Crowd Favorite",
    playerId: top.playerId, playerName: nameFor(top.playerId, top.player?.name),
    detail: variant([
      `"${top.name}" — top-rated song of the night`,
      `nobody topped "${top.name}" tonight`,
      `"${top.name}" had the whole room`,
    ], seed, "crowd_favorite"),
  });

  // 💀 Aux Privileges Revoked — single lowest-scoring song (computed early so Robbed can avoid it)
  const bottom = songs.reduce((a, b) => (b.totalRecords < a.totalRecords ? b : a), songs[0]);

  // 💔 Robbed — best song by a player who DIDN'T win the game (skip if it's just the top or the worst song)
  if (winnerId && distinctPlayers >= 2) {
    const others = songs.filter((s) => s.playerId !== winnerId);
    if (others.length) {
      const robbed = others.reduce((a, b) => (b.totalRecords > a.totalRecords ? b : a), others[0]);
      if (robbed.songId !== top.songId && robbed.songId !== bottom.songId) {
        awards.push({
          id: "robbed", emoji: "💔", kind: "glory", title: "Robbed",
          playerId: robbed.playerId, playerName: nameFor(robbed.playerId, robbed.player?.name),
          detail: variant([
            `"${robbed.name}" banged — still didn't take the crown`,
            `"${robbed.name}" deserved way better`,
            `"${robbed.name}" got snubbed, plain and simple`,
          ], seed, "robbed"),
        });
      }
    }
  }

  // 🐎 Dark Horse — the winner trailed at the midpoint, then took it
  if (winnerId && numRounds >= 2) {
    const half = Math.floor(numRounds / 2);
    if (half >= 1) {
      const cum = new Map();
      for (const r of allRounds) {
        if (r.round > half) continue;
        for (const s of r.songs || []) cum.set(s.playerId, (cum.get(s.playerId) || 0) + (s.totalRecords || 0));
      }
      let midLeader = null, midMax = -1;
      for (const [pid, val] of cum) if (val > midMax) { midMax = val; midLeader = pid; }
      if (midLeader && midLeader !== winnerId) {
        awards.push({
          id: "dark_horse", emoji: "🐎", kind: "glory", title: "Dark Horse",
          playerId: winnerId, playerName: winner.playerName,
          detail: variant([
            "trailed at the half — took the whole thing",
            "came from behind and stole it",
            "down at the midpoint, champion by the end",
          ], seed, "dark_horse"),
        });
      }
    }
  }

  // ---------- ROASTS ----------
  awards.push({
    id: "aux_revoked", emoji: "💀", kind: "roast", title: "Aux Privileges Revoked",
    playerId: bottom.playerId, playerName: nameFor(bottom.playerId, bottom.player?.name),
    detail: variant([
      `"${bottom.name}" — lowest-rated pick of the night`,
      `"${bottom.name}" cleared the room`,
      `nobody was feeling "${bottom.name}"`,
    ], seed, "aux_revoked"),
  });

  // Per-player song-score lists for the consistency roasts
  const scoresByPlayer = new Map();
  for (const s of songs) {
    const arr = scoresByPlayer.get(s.playerId) || [];
    arr.push(s.totalRecords || 0);
    scoresByPlayer.set(s.playerId, arr);
  }

  if (numRounds >= MIN_ROUNDS_FOR_CONSISTENCY) {
    const eligible = [...scoresByPlayer.entries()].filter(([, arr]) => arr.length >= MIN_ROUNDS_FOR_CONSISTENCY);

    // 🧊 Read the Room — lowest average song score
    let worst = null, worstAvg = Infinity;
    for (const [pid, arr] of eligible) {
      const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
      if (avg < worstAvg) { worstAvg = avg; worst = pid; }
    }
    if (worst) awards.push({
      id: "read_the_room", emoji: "🧊", kind: "roast", title: "Read the Room",
      playerId: worst, playerName: nameFor(worst),
      detail: variant([
        "picks consistently fell flat",
        "read the room… wrong, every time",
        "the vibes were never quite right",
      ], seed, "read_the_room"),
    });

    // 🫥 Certified NPC — lowest variance (forgettably mid every round)
    let npc = null, lowVar = Infinity;
    for (const [pid, arr] of eligible) {
      const v = variance(arr);
      if (v < lowVar) { lowVar = v; npc = pid; }
    }
    if (npc) awards.push({
      id: "npc", emoji: "🫥", kind: "roast", title: "Certified NPC",
      playerId: npc, playerName: nameFor(npc),
      detail: variant([
        "every pick landed dead-center. forgettable.",
        "mid every round. NPC behavior.",
        "consistently, aggressively average",
      ], seed, "npc"),
    });

    // 🎭 One-Hit Wonder — highest variance (one peak, rest tanked), excluding the winner
    let ohw = null, hiVar = 0;
    for (const [pid, arr] of eligible) {
      if (pid === winnerId) continue;
      const v = variance(arr);
      if (v > hiVar) { hiVar = v; ohw = pid; }
    }
    if (ohw) awards.push({
      id: "one_hit_wonder", emoji: "🎭", kind: "roast", title: "One-Hit Wonder",
      playerId: ohw, playerName: nameFor(ohw),
      detail: variant([
        "one banger, then… silence",
        "peaked once, ghosted after",
        "all that hype for one song",
      ], seed, "one_hit_wonder"),
    });
  }

  // ---------- JUDGE (voter behavior) ----------
  const voters = voterAwards.filter((v) => v.count >= MIN_VOTES_FOR_JUDGE);
  if (voters.length >= MIN_VOTERS_FOR_JUDGE) {
    const hater = voters.reduce((a, b) => (b.avgGiven < a.avgGiven ? b : a), voters[0]);
    awards.push({
      id: "hater", emoji: "🧂", kind: "judge", title: "The Hater",
      playerId: hater.voterId, playerName: nameFor(hater.voterId),
      detail: variant([
        `harshest critic — ${hater.avgGiven.toFixed(1)} avg given`,
        `stingy with the records — ${hater.avgGiven.toFixed(1)} avg`,
        `tough crowd of one — ${hater.avgGiven.toFixed(1)} avg given`,
      ], seed, "hater"),
    });

    const easy = voters.reduce((a, b) => (b.avgGiven > a.avgGiven ? b : a), voters[0]);
    if (easy.voterId !== hater.voterId) awards.push({
      id: "easy_grader", emoji: "❤️", kind: "judge", title: "Easy Grader",
      playerId: easy.voterId, playerName: nameFor(easy.voterId),
      detail: variant([
        `handed out 5s like candy — ${easy.avgGiven.toFixed(1)} avg`,
        `everybody's a winner — ${easy.avgGiven.toFixed(1)} avg given`,
        `generous to a fault — ${easy.avgGiven.toFixed(1)} avg`,
      ], seed, "easy_grader"),
    });

    const kingmaker = voters.reduce((a, b) => (b.kingmakerHits > a.kingmakerHits ? b : a), voters[0]);
    if (kingmaker.kingmakerHits > 0) awards.push({
      id: "kingmaker", emoji: "👑", kind: "judge", title: "Kingmaker",
      playerId: kingmaker.voterId, playerName: nameFor(kingmaker.voterId),
      detail: variant([
        "kept backing the winners",
        "always picked the eventual champ",
        "had an eye for the winners",
      ], seed, "kingmaker"),
    });
  }

  return awards;
}
