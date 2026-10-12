import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import presenceComponent from "@convex-dev/presence/test";
import { SHARE_TTL_MS, reelSeed } from "./results";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./**/*.d.ts"]);

function setup() {
  const t = convexTest(schema, modules);
  presenceComponent.register(t, "presence");
  return t;
}
type T = ReturnType<typeof setup>;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const conn = (id: string) => `conn-${id}`;
const as = (code: string, id: string) => ({ code, playerId: id, connectionId: conn(id) });

/** A hosted room with three players and two finished rounds, in gameOver. */
async function finishedGame(t: T) {
  const { code } = await t.mutation(api.game.rooms.hostGame, {});
  for (const id of ["qa-maya", "qa-dev", "qa-sam"]) {
    const res = await t.mutation(api.game.rooms.joinGame, { ...as(code, id), name: `QA ${id.slice(3)}` });
    expect(res.success).toBe(true);
  }
  const ids = await t.run(async (ctx) => {
    const room = await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", code)).unique();
    await ctx.db.patch(room!._id, { phase: "gameOver", currentRound: 2 });
    const song = (round: number, playerId: string, name: string) =>
      ctx.db.insert("submissions", {
        roomCode: code, round, playerId, trackId: `yt:${name}`,
        trackDetails: { name, artist: "QA Artist", albumCover: `https://i.ytimg.com/vi/${name}/mqdefault.jpg`, videoId: name },
        submittedAt: Date.now(),
      } as never);
    const r1 = [await song(1, "qa-maya", "alpha"), await song(1, "qa-dev", "bravo"), await song(1, "qa-sam", "charlie")];
    const r2 = [await song(2, "qa-maya", "delta"), await song(2, "qa-dev", "echo"), await song(2, "qa-sam", "foxtrot")];
    const players = ["qa-maya", "qa-dev", "qa-sam"];
    const results = (songs: typeof r1, names: string[], scores: number[]) =>
      songs.map((songId, i) => ({
        songId, playerId: players[i], name: names[i], artist: "QA Artist",
        albumCover: `https://i.ytimg.com/vi/${names[i]}/mqdefault.jpg`, totalRecords: scores[i], isWinner: i === 0,
      }));
    await ctx.db.insert("roundResults", {
      roomCode: code, round: 1, prompt: "A song for a late-night drive.", winnerSongId: r1[0],
      results: results(r1, ["alpha", "bravo", "charlie"], [9, 7, 4]), calculatedAt: Date.now(),
    });
    await ctx.db.insert("roundResults", {
      roomCode: code, round: 2, prompt: "The ultimate cookout anthem.", winnerSongId: r2[0],
      results: results(r2, ["delta", "echo", "foxtrot"], [10, 6, 5]), calculatedAt: Date.now(),
    });
    await ctx.db.insert("ratings", { roomCode: code, round: 1, songId: r1[0], voterId: "qa-dev", rating: 5, submittedAt: Date.now() });
    await ctx.db.insert("ratings", { roomCode: code, round: 1, songId: r1[1], voterId: "qa-maya", rating: 3, submittedAt: Date.now() });
    return { r1, r2 };
  });
  return { code, ...ids };
}

describe("reelSeed", () => {
  test("matches the client's hashStr for the same input (shared vector with resultsModel.test.js)", () => {
    expect(reelSeed("ABC123", [{ winnerSongId: "song-a", round: 1 }, { winnerSongId: "song-b", round: 2 }, { round: 3 }])).toBe(19227425);
  });
});

describe("shared results", () => {
  test("a player in the finished game gets a link, and the page reads the game back", async () => {
    const t = setup();
    const { code, r1, r2 } = await finishedGame(t);
    const res = await t.mutation(api.results.share, as(code, "qa-dev"));
    expect(res).toMatchObject({ success: true });
    const shareId = (res as { shareId: string }).shareId;
    expect(shareId).toMatch(/^[a-z0-9]{12}$/);

    const page = await t.query(api.results.get, { shareId });
    expect(page!.players.map((p) => p.name).sort()).toEqual(["QA dev", "QA maya", "QA sam"]);
    expect(page!.rounds).toHaveLength(2);
    expect(page!.rounds[0]).toMatchObject({ round: 1, prompt: "A song for a late-night drive." });
    expect(page!.rounds[0].songs.map((s) => [s.name, s.totalRecords, s.player.name])).toEqual([
      ["alpha", 9, "QA maya"],
      ["bravo", 7, "QA dev"],
      ["charlie", 4, "QA sam"],
    ]);
    // Each song carries playerId as well as player, like the live round results.
    for (const s of page!.rounds[0].songs) expect(s.playerId).toBe(s.player.id);
    expect(page!.rounds[0].songs.map((s) => s.isWinner)).toEqual([true, false, false]);
    // The winner key points at a song in the same round.
    expect(page!.rounds[0].songs.map((s) => s.songId)).toContain(page!.rounds[0].winnerSongId);
    expect(page!.rounds[0].songs.find((s) => s.songId === page!.rounds[0].winnerSongId)!.name).toBe("alpha");
    expect(page!.voterAwards.map((a) => a.count).sort()).toEqual([1, 1]);
    // Same seed the final screen derives, so the same awards are picked.
    expect(page!.seed).toBe(reelSeed(code, [{ winnerSongId: r1[0], round: 1 }, { winnerSongId: r2[0], round: 2 }]));
  });

  test("nothing in the page reaches back into the room", async () => {
    const t = setup();
    const { code, r1, r2 } = await finishedGame(t);
    const { shareId } = (await t.mutation(api.results.share, as(code, "qa-maya"))) as { shareId: string };
    const text = JSON.stringify(await t.query(api.results.get, { shareId }));
    expect(text).not.toContain(code);
    for (const secret of ["qa-maya", "qa-dev", "qa-sam", ...r1, ...r2]) expect(text).not.toContain(secret);
  });

  test("song details a client supplied are cleaned before they go public", async () => {
    const t = setup();
    const { code } = await finishedGame(t);
    await t.run(async (ctx) => {
      const rr = await ctx.db.query("roundResults").withIndex("by_room_round", (q) => q.eq("roomCode", code).eq("round", 1)).unique();
      const results = rr!.results.map((r, i) =>
        i === 1 ? { ...r, name: "y".repeat(400), artist: "  spaced   out  ", albumCover: "https://evil.example/pixel.gif" } : r
      );
      await ctx.db.patch(rr!._id, { results });
    });
    const { shareId } = (await t.mutation(api.results.share, as(code, "qa-maya"))) as { shareId: string };
    const songs = (await t.query(api.results.get, { shareId }))!.rounds[0].songs;
    expect(songs[1].name).toHaveLength(120);
    expect(songs[1].artist).toBe("spaced out");
    expect(songs[1].albumCover).toBe("");
    // A real catalog cover is kept as is.
    expect(songs[0].albumCover).toBe("https://i.ytimg.com/vi/alpha/mqdefault.jpg");
  });

  test("one snapshot per game, whoever asks", async () => {
    const t = setup();
    const { code } = await finishedGame(t);
    const a = (await t.mutation(api.results.share, as(code, "qa-maya"))) as { shareId: string };
    const b = (await t.mutation(api.results.share, as(code, "qa-sam"))) as { shareId: string };
    expect(b.shareId).toBe(a.shareId);
    expect(await t.run(async (ctx) => (await ctx.db.query("sharedResults").collect()).length)).toBe(1);
  });

  test("only a seated player on their own connection can share, and only at game over", async () => {
    const t = setup();
    const { code } = await finishedGame(t);
    expect(await t.mutation(api.results.share, { code, playerId: "qa-stranger", connectionId: "c" })).toMatchObject({ success: false });
    expect(await t.mutation(api.results.share, { code, playerId: "qa-maya", connectionId: "someone-else" })).toMatchObject({ success: false });
    expect(await t.mutation(api.results.share, { code: "NOROOM", playerId: "qa-maya", connectionId: conn("qa-maya") })).toMatchObject({ success: false });

    await t.run(async (ctx) => {
      const room = await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", code)).unique();
      await ctx.db.patch(room!._id, { phase: "rating" });
    });
    expect(await t.mutation(api.results.share, as(code, "qa-maya"))).toMatchObject({ success: false });
    expect(await t.run(async (ctx) => (await ctx.db.query("sharedResults").collect()).length)).toBe(0);
  });

  test("a link expires after 30 days and is then pruned; unknown and malformed ids read as missing", async () => {
    const t = setup();
    const { code } = await finishedGame(t);
    const { shareId } = (await t.mutation(api.results.share, as(code, "qa-maya"))) as { shareId: string };
    expect(await t.query(api.results.get, { shareId: "zzzzzzzzzzzz" })).toBeNull();
    expect(await t.query(api.results.get, { shareId: "../../etc" })).toBeNull();

    vi.advanceTimersByTime(SHARE_TTL_MS - 1000);
    expect(await t.query(api.results.get, { shareId })).not.toBeNull();
    expect(await t.mutation(internal.results.pruneExpired, {})).toEqual({ deleted: 0 });

    vi.advanceTimersByTime(2000);
    expect(await t.query(api.results.get, { shareId })).toBeNull();
    expect(await t.mutation(internal.results.pruneExpired, {})).toEqual({ deleted: 1 });
  });

  test("the snapshot outlives the room", async () => {
    const t = setup();
    const { code } = await finishedGame(t);
    const { shareId } = (await t.mutation(api.results.share, as(code, "qa-maya"))) as { shareId: string };
    await t.run(async (ctx) => {
      for (const table of ["rooms", "players", "roundResults", "ratings", "submissions"] as const) {
        for (const row of await ctx.db.query(table).collect()) await ctx.db.delete(row._id);
      }
    });
    const page = await t.query(api.results.get, { shareId });
    expect(page!.rounds).toHaveLength(2);
    expect(page!.players).toHaveLength(3);
  });
});
