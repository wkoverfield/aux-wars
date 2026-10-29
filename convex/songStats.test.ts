import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import presenceComponent from "@convex-dev/presence/test";
import { songKey } from "./songStats";
import { CURATED_PROMPTS } from "./game/promptPacks";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./**/*.d.ts"]);

function setup() {
  const t = convexTest(schema, modules);
  presenceComponent.register(t, "presence");
  return t;
}
type T = ReturnType<typeof setup>;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const as = (code: string, id: string) => ({ code, playerId: id, connectionId: `conn-${id}` });
const PROMPT = CURATED_PROMPTS[0];

describe("songKey", () => {
  test("matches catalog and YouTube copies of one song", () => {
    const catalog = songKey("Blinding Lights", "The Weeknd");
    expect(songKey("The Weeknd - Blinding Lights (Official Video)", "TheWeekndVEVO")).toBe(catalog);
    expect(songKey("Blinding Lights [Official Audio]", "The Weeknd - Topic")).toBe(catalog);
    expect(songKey("BLINDING LIGHTS", "the weeknd")).toBe(catalog);
  });

  test("drops featured artists from the title", () => {
    expect(songKey("Sicko Mode (feat. Drake)", "Travis Scott")).toBe(songKey("SICKO MODE", "Travis Scott"));
    expect(songKey("Sicko Mode feat. Drake", "Travis Scott")).toBe(songKey("SICKO MODE", "Travis Scott"));
    expect(songKey("Señorita", "Shawn Mendes & Camila Cabello")).toBe("shawn mendes and camila cabello|senorita");
  });

  test("keeps words that are part of the title or the artist", () => {
    expect(songKey("Video Games", "Lana Del Rey")).toBe("lana del rey|video games");
    expect(songKey("Lose Yourself", "Eminem")).not.toBe(songKey("Lose Control", "Eminem"));
    expect(songKey("Dancing With Myself", "Billy Idol")).toBe("billy idol|dancing with myself");
    expect(songKey("Stay With Me", "Sam Smith")).not.toBe(songKey("Stay", "Sam Smith"));
    expect(songKey("September", "Earth, Wind & Fire")).toBe("earth wind and fire|september");
    expect(songKey("September", "Earth, Wind & Fire")).not.toBe(songKey("September", "Earth"));
  });

  test("keeps non-Latin titles and artists distinct", () => {
    const a = songKey("봄날", "BTS");
    const b = songKey("피 땀 눈물", "BTS");
    expect(a).not.toBeNull();
    expect(a).not.toBe(b);
    expect(songKey("夜に駆ける", "YOASOBI")).not.toBe(songKey("群青", "YOASOBI"));
  });

  test("rejects empty halves and oversized keys", () => {
    expect(songKey("", "Band")).toBeNull();
    expect(songKey("!!!", "Band")).toBeNull();
    expect(songKey("Song", "")).toBeNull();
    expect(songKey("a".repeat(5000), "Band")).toBeNull();
  });
});

/** A room in the rating phase of round 1 with each player's song rated. */
async function ratedRound(
  t: T,
  prompt: string,
  picks: { player: string; name: string; artist: string; ratings: number[] }[]
) {
  const { code } = await t.mutation(api.game.rooms.hostGame, {});
  for (const p of picks) {
    const res = await t.mutation(api.game.rooms.joinGame, { ...as(code, p.player), name: p.player });
    expect(res.success).toBe(true);
  }
  await t.run(async (ctx) => {
    const room = await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", code)).unique();
    await ctx.db.patch(room!._id, { phase: "rating", currentRound: 1, currentPrompt: prompt });
    for (const [i, p] of picks.entries()) {
      const songId = await ctx.db.insert("submissions", {
        roomCode: code, round: 1, playerId: p.player, trackId: `itunes:${p.name}`,
        trackDetails: { name: p.name, artist: p.artist, albumCover: "https://example.com/a.jpg", previewUrl: "https://example.com/p.m4a" },
        submittedAt: 1000 + i,
      });
      for (const [j, rating] of p.ratings.entries()) {
        await ctx.db.insert("ratings", { roomCode: code, round: 1, songId, voterId: `v${j}`, rating, submittedAt: 2000 });
      }
    }
  });
  await t.mutation(internal.game.flow.calculateResultsInternal, { code, round: 1 });
  return code;
}

const statsFor = (t: T, key: string | null) =>
  t.run((ctx) => ctx.db.query("songStats").withIndex("by_song_prompt", (q) => q.eq("songKey", key!)).collect());

describe("recordRoundSongStats", () => {
  test("a finished round writes overall and per-prompt rows", async () => {
    const t = setup();
    await ratedRound(t, PROMPT, [
      { player: "qa-a", name: "Alpha", artist: "Band A", ratings: [5, 4, -1] },
      { player: "qa-b", name: "Bravo", artist: "Band B", ratings: [2, -1, 3] },
    ]);
    const rows = await statsFor(t, songKey("Alpha", "Band A"));
    expect(rows).toHaveLength(2);
    const overall = rows.find((r) => r.prompt === undefined)!;
    const perPrompt = rows.find((r) => r.prompt === PROMPT)!;
    for (const r of [overall, perPrompt]) {
      expect(r).toMatchObject({ picks: 1, wins: 1, ratingCount: 2, ratingSum: 9, ratingHist: [0, 0, 0, 1, 1] });
    }
    const bravo = await statsFor(t, songKey("Bravo", "Band B"));
    expect(bravo.find((r) => r.prompt === undefined)).toMatchObject({ wins: 0, ratingCount: 2, ratingSum: 5 });
  });

  test("stores no player, voter or room identifiers", async () => {
    const t = setup();
    const code = await ratedRound(t, PROMPT, [{ player: "qa-a", name: "Alpha", artist: "Band A", ratings: [4] }]);
    const rows = await t.run((ctx) => ctx.db.query("songStats").collect());
    const text = JSON.stringify(rows);
    expect(text).not.toContain("qa-a");
    expect(text).not.toContain(code);
    expect(text).not.toContain("\"v0\"");
  });

  test("a custom prompt counts toward the overall row only and is never stored", async () => {
    const t = setup();
    await ratedRound(t, "songs my ex ruined for me, Jordan", [
      { player: "qa-a", name: "Alpha", artist: "Band A", ratings: [3] },
    ]);
    const rows = await t.run((ctx) => ctx.db.query("songStats").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].prompt).toBeUndefined();
    expect(JSON.stringify(rows)).not.toContain("Jordan");
  });

  test("the same song across games accumulates on one key", async () => {
    const t = setup();
    await ratedRound(t, PROMPT, [{ player: "qa-a", name: "Blinding Lights", artist: "The Weeknd", ratings: [5] }]);
    await ratedRound(t, PROMPT, [
      { player: "qa-b", name: "The Weeknd - Blinding Lights (Official Video)", artist: "TheWeekndVEVO", ratings: [3, 1] },
    ]);
    const overall = (await statsFor(t, songKey("Blinding Lights", "The Weeknd"))).find((r) => r.prompt === undefined)!;
    expect(overall).toMatchObject({ picks: 2, wins: 2, ratingCount: 3, ratingSum: 9, ratingHist: [1, 0, 1, 0, 1] });
    expect(overall.name).toBe("Blinding Lights");
    expect(overall.sources).toHaveLength(2);
  });

  test("survives the room being deleted", async () => {
    const t = setup();
    const code = await ratedRound(t, PROMPT, [{ player: "qa-a", name: "Alpha", artist: "Band A", ratings: [4] }]);
    await t.run(async (ctx) => {
      const room = await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", code)).unique();
      await ctx.db.patch(room!._id, { lastActivityAt: 0 });
    });
    vi.advanceTimersByTime(48 * 60 * 60 * 1000);
    await t.mutation(internal.game.scheduler.cleanupStaleRooms, {});
    const left = await t.run(async (ctx) => ({
      rooms: await ctx.db.query("rooms").collect(),
      subs: await ctx.db.query("submissions").collect(),
      stats: await ctx.db.query("songStats").collect(),
    }));
    expect(left.rooms).toHaveLength(0);
    expect(left.subs).toHaveLength(0);
    expect(left.stats).toHaveLength(2);
  });

  test("an oversized title is skipped and the round still finishes", async () => {
    const t = setup();
    const code = await ratedRound(t, PROMPT, [
      { player: "qa-a", name: "x".repeat(20000), artist: "Band A", ratings: [4] },
      { player: "qa-b", name: "Bravo", artist: "Band B", ratings: [3] },
    ]);
    const after = await t.run(async (ctx) => ({
      room: await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", code)).unique(),
      results: await ctx.db.query("roundResults").collect(),
      stats: await ctx.db.query("songStats").collect(),
    }));
    expect(after.room!.phase).toBe("results");
    expect(after.results).toHaveLength(1);
    expect(after.stats.map((s) => s.songKey)).toEqual(["band b|bravo", "band b|bravo"]);
  });

  test("a second results calculation for the same round adds nothing", async () => {
    const t = setup();
    const code = await ratedRound(t, PROMPT, [{ player: "qa-a", name: "Alpha", artist: "Band A", ratings: [4] }]);
    await t.mutation(internal.game.flow.calculateResultsInternal, { code, round: 1 });
    const overall = (await statsFor(t, songKey("Alpha", "Band A"))).find((r) => r.prompt === undefined)!;
    expect(overall.picks).toBe(1);
  });
});
