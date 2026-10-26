import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import presenceComponent from "@convex-dev/presence/test";
import { presence } from "./presence";
import { MAX_SCREENS_PER_ROOM, SCREEN_HEARTBEAT_INTERVAL_MS, screenRoomKey } from "./screens";
import { RATING_TIMEOUT_MS, SCREEN_HOLD_GRACE_MS, clipLengthMs } from "./game/flow";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./**/*.d.ts"]);

type T = ReturnType<typeof setup>;

function setup() {
  const t = convexTest(schema, modules);
  presenceComponent.register(t, "presence");
  return t;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const conn = (id: string) => `conn-${id}`;
const as = (code: string, id: string) => ({ code, playerId: id, connectionId: conn(id) });
const SCREEN = "screen-0123456789";

async function advance(t: T, ms: number) {
  vi.advanceTimersByTime(ms);
  await t.finishInProgressScheduledFunctions();
  for (let i = 0; i < 4; i++) {
    vi.advanceTimersByTime(1);
    await t.finishInProgressScheduledFunctions();
  }
}

async function hostedRoom(t: T, ids: string[]) {
  const { code } = await t.mutation(api.game.rooms.hostGame, {});
  for (const id of ids) {
    const res = await t.mutation(api.game.rooms.joinGame, { ...as(code, id), name: `QA-${id}` });
    expect(res.success).toBe(true);
  }
  return code as string;
}

async function room(t: T, code: string) {
  return await t.run(async (ctx) =>
    ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", code)).unique()
  );
}

async function players(t: T, code: string) {
  return await t.run(async (ctx) =>
    ctx.db.query("players").withIndex("by_room", (q) => q.eq("roomCode", code)).collect()
  );
}

type Track = { videoId?: string; previewUrl?: string; snippet?: { startTime: number; endTime: number } };

/**
 * Puts the room into rating with one submission per player (in id order) and
 * runs the first rating step, which arms the rating timeout.
 */
async function startRating(t: T, code: string, ids: string[], track: Track, snippetDuration = 30) {
  await t.run(async (ctx) => {
    const r = await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", code)).unique();
    await ctx.db.patch(r!._id, {
      phase: "songSelection",
      currentRound: 1,
      settings: { ...r!.settings, snippetDuration },
    });
    let at = Date.now() - 10_000;
    for (const id of ids) {
      await ctx.db.insert("submissions", {
        roomCode: code,
        round: 1,
        playerId: id,
        trackId: `track-${id}`,
        trackDetails: { name: `Song ${id}`, artist: "QA", albumCover: "", ...track },
        submittedAt: at++,
      });
    }
  });
  await t.mutation(internal.game.flow.startRatingPhaseInternal, { code, round: 1 });
  await advance(t, 500);
}

async function currentSong(t: T, code: string) {
  return await t.query(api.game.flow.getCurrentRatingSong, { code });
}

/** Every player except the current song's submitter rates it. */
async function everyoneRates(t: T, code: string, ids: string[]) {
  const song = (await currentSong(t, code))!;
  for (const id of ids) {
    if (id === song.player.id) continue;
    const res = await t.mutation(api.game.flow.submitRating, { ...as(code, id), songId: song.songId, rating: 4 });
    expect(res.success).toBe(true);
  }
  await advance(t, 0);
}

const index = async (t: T, code: string) => (await room(t, code))!.currentRatingIndex;

describe("screen presence", () => {
  test("screenAttached turns on with a heartbeat and off on leave or timeout", async () => {
    const t = setup();
    const code = await hostedRoom(t, ["h"]);
    expect(await t.query(api.screens.screenAttached, { code })).toBe(false);

    expect(await t.mutation(api.screens.heartbeat, { code, screenId: SCREEN })).toEqual({ ok: true });
    expect(await t.query(api.screens.screenAttached, { code })).toBe(true);

    await t.mutation(api.screens.leave, { code, screenId: SCREEN });
    expect(await t.query(api.screens.screenAttached, { code })).toBe(false);

    await t.mutation(api.screens.heartbeat, { code, screenId: SCREEN });
    expect(await t.query(api.screens.screenAttached, { code })).toBe(true);
    // A beat inside the timeout keeps it on; silence past 2.5x the interval drops it.
    await advance(t, SCREEN_HEARTBEAT_INTERVAL_MS);
    await t.mutation(api.screens.heartbeat, { code, screenId: SCREEN });
    await advance(t, SCREEN_HEARTBEAT_INTERVAL_MS * 2);
    expect(await t.query(api.screens.screenAttached, { code })).toBe(true);
    await advance(t, SCREEN_HEARTBEAT_INTERVAL_MS);
    expect(await t.query(api.screens.screenAttached, { code })).toBe(false);
  });

  test("a heartbeat never creates a player, writes the room, or shows in player presence", async () => {
    const t = setup();
    const code = await hostedRoom(t, ["h", "g"]);
    const roomBefore = await room(t, code);
    const playersBefore = await players(t, code);

    await t.mutation(api.screens.heartbeat, { code, screenId: SCREEN });
    await t.mutation(api.screens.heartbeat, { code: code.toLowerCase(), screenId: SCREEN });

    expect(await room(t, code)).toEqual(roomBefore);
    expect(await players(t, code)).toEqual(playersBefore);
    const playerPresence = await t.run(async (ctx) => presence.listRoom(ctx, code, false));
    expect(playerPresence).toEqual([]);
    const screenPresence = await t.run(async (ctx) => presence.listRoom(ctx, screenRoomKey(code), false));
    expect(screenPresence.map((p) => p.userId)).toEqual([SCREEN]);
    const view = await t.query(api.game.rooms.getRoomByCode, { code });
    expect(view!.players).toHaveLength(2);
  });

  test("bad shapes and unknown rooms are no-ops", async () => {
    const t = setup();
    const code = await hostedRoom(t, ["h"]);
    expect(await t.mutation(api.screens.heartbeat, { code: "QAZZZZ", screenId: SCREEN })).toEqual({ ok: false });
    expect(await t.mutation(api.screens.heartbeat, { code: "not a code", screenId: SCREEN })).toEqual({ ok: false });
    expect(await t.mutation(api.screens.heartbeat, { code, screenId: "short" })).toEqual({ ok: false });
    expect(await t.mutation(api.screens.heartbeat, { code, screenId: "has spaces in it" })).toEqual({ ok: false });
    expect(await t.query(api.screens.screenAttached, { code: "QAZZZZ" })).toBe(false);
    expect(await t.query(api.screens.screenAttached, { code: "??" })).toBe(false);
    expect(await t.mutation(api.screens.leave, { code: "QAZZZZ", screenId: SCREEN })).toBeNull();
    const rows = await t.run(async (ctx) => presence.listRoom(ctx, screenRoomKey("QAZZZZ"), false));
    expect(rows).toEqual([]);
  });

  test("a public room never registers a screen", async () => {
    const t = setup();
    const code = await hostedRoom(t, ["h"]);
    await t.run(async (ctx) => {
      const r = await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", code)).unique();
      await ctx.db.patch(r!._id, { isPublic: true });
    });
    expect(await t.mutation(api.screens.heartbeat, { code, screenId: SCREEN })).toEqual({ ok: false });
    expect(await t.query(api.screens.screenAttached, { code })).toBe(false);
    const rows = await t.run(async (ctx) => presence.listRoom(ctx, screenRoomKey(code), false));
    expect(rows).toEqual([]);
  });

  test("a room holds a bounded number of online screens", async () => {
    const t = setup();
    const code = await hostedRoom(t, ["h"]);
    for (let i = 0; i < MAX_SCREENS_PER_ROOM; i++) {
      expect(await t.mutation(api.screens.heartbeat, { code, screenId: `screen-slot-${i}` })).toEqual({ ok: true });
    }
    expect(await t.mutation(api.screens.heartbeat, { code, screenId: "screen-one-too-many" })).toEqual({ ok: false });
    // An already-online screen keeps beating.
    expect(await t.mutation(api.screens.heartbeat, { code, screenId: "screen-slot-0" })).toEqual({ ok: true });
  });

  test("deleting the room clears its screens", async () => {
    const t = setup();
    const code = await hostedRoom(t, ["h"]);
    await t.mutation(api.screens.heartbeat, { code, screenId: SCREEN });
    await t.mutation(api.game.rooms.leaveGame, as(code, "h"));
    expect(await room(t, code)).toBeNull();
    const rows = await t.run(async (ctx) => presence.listRoom(ctx, screenRoomKey(code), false));
    expect(rows).toEqual([]);
  });
});

describe("song hold with a shared screen", () => {
  const ids = ["h", "a", "b"];
  const window20s: Track = { videoId: "vid", snippet: { startTime: 10, endTime: 30 } };

  test("without a screen the last vote advances at once", async () => {
    const t = setup();
    const code = await hostedRoom(t, ids);
    await startRating(t, code, ids, window20s);
    expect(await index(t, code)).toBe(0);
    await advance(t, 1_000);
    await everyoneRates(t, code, ids);
    expect(await index(t, code)).toBe(1);
  });

  test("with a screen the last vote waits for the clip to finish", async () => {
    const t = setup();
    const code = await hostedRoom(t, ids);
    await t.mutation(api.screens.heartbeat, { code, screenId: SCREEN });
    await startRating(t, code, ids, window20s);
    const startedAt = (await room(t, code))!.ratingSongStartedAt!;
    expect(startedAt).toBeTypeOf("number");

    await advance(t, 1_000);
    await everyoneRates(t, code, ids);
    expect(await index(t, code)).toBe(0);

    const holdEnd = startedAt + 20_000 + SCREEN_HOLD_GRACE_MS;
    await advance(t, holdEnd - Date.now() - 500);
    expect(await index(t, code)).toBe(0);
    await advance(t, 1_000);
    expect(await index(t, code)).toBe(1);
    const next = (await room(t, code))!.ratingSongStartedAt!;
    expect(next).toBeGreaterThanOrEqual(holdEnd);
  });

  test("a public room is never held, even with a screen row present", async () => {
    const t = setup();
    const code = await hostedRoom(t, ids);
    // Register a screen directly in the component (heartbeat refuses public
    // rooms) and mark every player present, then make the room public.
    await t.run(async (ctx) => {
      await presence.heartbeat(ctx, screenRoomKey(code), SCREEN, `${code}:${SCREEN}`, SCREEN_HEARTBEAT_INTERVAL_MS);
      for (const id of ids) await presence.heartbeat(ctx, code, id, `s-${id}`, 30_000);
    });
    await startRating(t, code, ids, window20s);
    await t.run(async (ctx) => {
      const r = await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", code)).unique();
      await ctx.db.patch(r!._id, { isPublic: true });
    });
    await advance(t, 1_000);
    await everyoneRates(t, code, ids);
    expect(await index(t, code)).toBe(1);
  });

  test("a vote after the clip has played advances at once", async () => {
    const t = setup();
    const code = await hostedRoom(t, ids);
    await t.mutation(api.screens.heartbeat, { code, screenId: SCREEN });
    await startRating(t, code, ids, window20s);
    await advance(t, 25_000);
    await everyoneRates(t, code, ids);
    expect(await index(t, code)).toBe(1);
  });

  test("a screen that leaves mid-hold does not stall the room", async () => {
    const t = setup();
    const code = await hostedRoom(t, ids);
    await t.mutation(api.screens.heartbeat, { code, screenId: SCREEN });
    await startRating(t, code, ids, window20s);
    await everyoneRates(t, code, ids);
    expect(await index(t, code)).toBe(0);
    await t.mutation(api.screens.leave, { code, screenId: SCREEN });
    await advance(t, 22_000);
    expect(await index(t, code)).toBe(1);
  });

  test("the rating timeout still caps a full-song hold, and the stale re-check no-ops", async () => {
    const t = setup();
    const code = await hostedRoom(t, ids);
    await t.mutation(api.screens.heartbeat, { code, screenId: SCREEN });
    await startRating(t, code, ids, { videoId: "vid" }, 0);
    await everyoneRates(t, code, ids);
    expect(await index(t, code)).toBe(0);
    await advance(t, RATING_TIMEOUT_MS - 2_000);
    expect(await index(t, code)).toBe(0);
    // Keep the screen online across the minute.
    await t.mutation(api.screens.heartbeat, { code, screenId: SCREEN });
    await advance(t, 3_000);
    expect(await index(t, code)).toBe(1);
    // Neither the timeout nor the hold re-check moved it twice.
    await advance(t, 1_000);
    expect(await index(t, code)).toBe(1);
  });

  test("a stale hold re-check for an earlier song does nothing", async () => {
    const t = setup();
    const code = await hostedRoom(t, ids);
    await startRating(t, code, ids, window20s);
    await everyoneRates(t, code, ids);
    expect(await index(t, code)).toBe(1);
    await advance(t, 500);
    const r = (await room(t, code))!;
    await t.mutation(internal.game.flow.maybeAdvanceOnAllVotes, { code, round: 1, ratingIndex: 0, epoch: r.gameEpoch ?? 0 });
    expect(await index(t, code)).toBe(1);
  });

  test("clip length: window, full song, preview, capped at the timeout", () => {
    const base = { name: "x", artist: "y", albumCover: "" };
    expect(clipLengthMs({ ...base, videoId: "v", snippet: { startTime: 5, endTime: 25 } }, 30)).toBe(20_000);
    expect(clipLengthMs({ ...base, videoId: "v", snippet: { startTime: 0, endTime: 0 } }, 0)).toBe(RATING_TIMEOUT_MS);
    expect(clipLengthMs({ ...base, videoId: "v", snippet: { startTime: 0, endTime: 300 } }, 0)).toBe(RATING_TIMEOUT_MS);
    expect(clipLengthMs({ ...base, previewUrl: "https://example.test/p.m4a" }, 30)).toBe(30_000);
    expect(clipLengthMs({ ...base, videoId: "v" }, 30)).toBe(30_000);
  });
});

describe("screen attribution", () => {
  test("joinGame records a screen QR join; a join without a source still validates", async () => {
    const t = setup();
    const { code } = await t.mutation(api.game.rooms.hostGame, {});
    expect((await t.mutation(api.game.rooms.joinGame, { ...as(code, "h"), name: "QA-h", source: "screen" })).success).toBe(true);
    expect((await t.mutation(api.game.rooms.joinGame, { ...as(code, "g"), name: "QA-g" })).success).toBe(true);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const joins = await t.run(async (ctx) =>
      ctx.db.query("analyticsEvents").withIndex("by_type", (q) => q.eq("eventType", "player_joined")).collect()
    );
    expect(joins.map((j) => j.metadata?.source)).toEqual(["screen", undefined]);
  });

  test("logEvent keeps only a well-formed room code on screen_opened", async () => {
    const t = setup();
    await t.mutation(api.analytics.logEvent, { eventType: "screen_opened", metadata: { roomCode: "abc123", playerId: "p1", label: "x" } });
    await t.mutation(api.analytics.logEvent, { eventType: "screen_opened", metadata: { roomCode: "<script>" } });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const rows = await t.run(async (ctx) =>
      ctx.db.query("analyticsEvents").withIndex("by_type", (q) => q.eq("eventType", "screen_opened")).collect()
    );
    expect(rows.map((r) => r.metadata)).toEqual([{ roomCode: "ABC123" }, {}]);
  });
});
