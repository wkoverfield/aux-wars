import { describe, expect, it } from "vitest";
import { computeAwards } from "./computeAwards";
import { hashStr, pickReel, recapSummary, reelSeedFor, standingsFrom } from "./resultsModel";

// A 4-player, 3-round game, in the shape getAllRoundResults returns.
const P = ["id-maya", "id-dev", "id-sam", "id-lee"];
const NAMES = { "id-maya": "Maya", "id-dev": "Dev", "id-sam": "Sam", "id-lee": "Lee" };
const SCORES = [
  [9, 7, 4, 6],
  [5, 10, 6, 3],
  [8, 6, 9, 2],
];
function game(ids = P, songId = (r, i) => `sub-${r}-${i}`) {
  return SCORES.map((row, r) => {
    const songs = row.map((totalRecords, i) => ({
      songId: songId(r + 1, i + 1),
      playerId: ids[i], // as in real round results: awards read this field
      name: `Song ${r + 1}.${i + 1}`,
      artist: "Artist",
      albumCover: "",
      totalRecords,
      player: { id: ids[i], name: NAMES[P[i]] },
    }));
    const top = songs.reduce((a, b) => (b.totalRecords > a.totalRecords ? b : a));
    return { round: r + 1, prompt: `Prompt ${r + 1}`, winnerSongId: top.songId, songs };
  });
}
const voters = (ids = P) => [
  { voterId: ids[0], avgGiven: 2.1, count: 9, kingmakerHits: 1 },
  { voterId: ids[1], avgGiven: 4.6, count: 9, kingmakerHits: 3 },
  { voterId: ids[2], avgGiven: 3.4, count: 9, kingmakerHits: 0 },
  { voterId: ids[3], avgGiven: 3.0, count: 9, kingmakerHits: 2 },
];
const reelFor = (rounds, players, voterAwards, seed) => {
  const playerStats = standingsFrom(rounds);
  return pickReel(computeAwards({ playerStats, allRounds: rounds, voterAwards, players, seed }), seed)
    .map((a) => [a.title, a.playerName, a.detail]);
};

describe("standingsFrom", () => {
  it("orders by round wins, then records", () => {
    expect(standingsFrom(game()).map((p) => [p.playerName, p.wins, p.totalRecords])).toEqual([
      ["Dev", 1, 23],
      ["Maya", 1, 22],
      ["Sam", 1, 19],
      ["Lee", 0, 11],
    ]);
  });
});

describe("reel seed", () => {
  it("matches the server's reelSeed for the same input (shared vector with convex/results.test.ts)", () => {
    expect(hashStr("ABC123|song-a|song-b|3")).toBe(19227425);
    expect(reelSeedFor("ABC123", [{ winnerSongId: "song-a", round: 1 }, { winnerSongId: "song-b", round: 2 }, { round: 3 }])).toBe(19227425);
  });
});

describe("a shared snapshot shows the awards the players saw", () => {
  it("picks the same reel from snapshot keys as from the live game's ids", () => {
    const liveRounds = game();
    const seed = reelSeedFor("ABC123", liveRounds);
    const live = reelFor(liveRounds, P.map((id) => ({ playerId: id, name: NAMES[id] })), voters(), seed);

    // The snapshot swaps player ids and song ids for local keys.
    const keys = ["p1", "p2", "p3", "p4"];
    const snapshotRounds = game(keys, (r, i) => `r${r}s${i}`);
    const shared = reelFor(snapshotRounds, keys.map((key, i) => ({ playerId: key, name: NAMES[P[i]] })), voters(keys), seed);

    expect(live.length).toBe(3);
    expect(shared).toEqual(live);
    // The fixture must exercise awards that tell players apart.
    const all = computeAwards({ playerStats: standingsFrom(liveRounds), allRounds: liveRounds, voterAwards: voters(), players: P.map((id) => ({ playerId: id, name: NAMES[id] })), seed });
    expect(new Set(all.map((a) => a.playerName)).size).toBeGreaterThan(1);
    expect(all.length).toBeGreaterThan(3);
  });
});

describe("recapSummary", () => {
  it("handles singular and plural", () => {
    expect(recapSummary(3, 2)).toBe("3 players, 2 rounds");
    expect(recapSummary(1, 1)).toBe("1 player, 1 round");
  });
});
