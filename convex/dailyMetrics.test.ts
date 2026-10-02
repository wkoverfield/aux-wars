import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import presenceComponent from "@convex-dev/presence/test";
import {
  addDays,
  computeDayMetrics,
  dayStartMs,
  dstr,
  percentile,
  type DayEvents,
  type DayInputs,
  type SlimEvent,
} from "./dailyMetrics";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./**/*.d.ts"]);
const HOUR = 60 * 60 * 1000;

function setup() {
  const t = convexTest(schema, modules);
  presenceComponent.register(t, "presence");
  return t;
}

function emptyEvents(): DayEvents {
  return {
    detail: {
      game_started: [],
      game_completed: [],
      game_abandoned: [],
      player_joined: [],
      search_no_results: [],
      search_failed: [],
      quickplay_matched: [],
      quickplay_left_waiting: [],
    },
    counts: {
      game_created: 0,
      song_submitted: 0,
      rating_submitted: 0,
      pro_purchased: 0,
      quickplay_clicked: 0,
      quickplay_1v1_offered: 0,
      quickplay_1v1_accepted: 0,
    },
  };
}

function inputs(over: Partial<DayInputs> = {}): DayInputs {
  return {
    date: "2026-09-01",
    computedAt: 1,
    events: emptyEvents(),
    pageviews: 0,
    uniqueVisitors: 0,
    newVisitors: null,
    newVisitorsPlayed: null,
    newPlayers: null,
    hours: null,
    ...over,
  };
}

describe("percentile", () => {
  test("nearest rank", () => {
    expect(percentile([], 0.9)).toBeNull();
    expect(percentile([4], 0.9)).toBe(4);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9);
    expect(percentile([2, 3, 8], 0.9)).toBe(8);
  });
});

describe("computeDayMetrics: Quick Play", () => {
  test("empty day has zero counts and null rates", () => {
    expect(computeDayMetrics(inputs())).toMatchObject({
      quickPlayClicks: 0,
      quickPlayMatched: 0,
      quickPlayMatchRate: null,
      quickPlayMedianWaitMs: null,
      quickPlayLeftWaiting: 0,
      quickPlayGamesStarted: 0,
      quickPlayAvgPlayersAtStart: null,
      quickPlay1v1Offered: 0,
      quickPlay1v1Accepted: 0,
    });
  });

  test("clicks, match rate, median wait, abandons and players at start", () => {
    const ev = emptyEvents();
    ev.counts = { ...ev.counts, quickplay_clicked: 5, quickplay_1v1_offered: 2, quickplay_1v1_accepted: 1 };
    ev.detail.quickplay_matched = [
      { waitedMs: 30_000, playersAtStart: 3 },
      { waitedMs: 10_000, playersAtStart: 3 },
      { waitedMs: 70_000, playersAtStart: 2 },
      { playersAtStart: 2 }, // no wait recorded: excluded from the median only
    ];
    ev.detail.quickplay_left_waiting = [{ waitedMs: 5000 }];
    ev.detail.game_started = [
      { roomCode: "QA0001", playerCount: 3, label: "quickplay" },
      { roomCode: "QA0002", playerCount: 2, label: "quickplay" },
      { roomCode: "QA0003", playerCount: 6 },
    ];
    expect(computeDayMetrics(inputs({ events: ev }))).toMatchObject({
      quickPlayClicks: 5,
      quickPlayMatched: 4,
      quickPlayMatchRate: 0.8,
      quickPlayMedianWaitMs: 30_000,
      quickPlayLeftWaiting: 1,
      quickPlayGamesStarted: 2,
      quickPlayAvgPlayersAtStart: 2.5,
      quickPlay1v1Offered: 2,
      quickPlay1v1Accepted: 1,
      gamesStarted: 3,
    });
  });
});

describe("computeDayMetrics", () => {
  test("empty day is zeros and nulls, never fabricated", () => {
    const row = computeDayMetrics(inputs());
    expect(row).toMatchObject({
      gamesStarted: 0,
      completionRate: null,
      avgPlayersPerGame: null,
      p90PlayersPerGame: null,
      maxPlayersPerGame: null,
      uniquePlayers: 0,
      newVisitors: null,
      returningVisitors: null,
      peakPlayersOnline: null,
      peakHourUTC: null,
      hourlyPeaks: [],
    });
  });

  test("games, players, funnel and abandonment", () => {
    const ev = emptyEvents();
    ev.counts = { ...ev.counts, game_created: 4, song_submitted: 30, rating_submitted: 90, pro_purchased: 1 };
    ev.detail.game_started = [
      { roomCode: "AAAA", playerCount: 3 },
      { roomCode: "BBBB", playerCount: 5 },
      { roomCode: "CCCC", playerCount: 2 },
    ];
    ev.detail.game_completed = [
      { roomCode: "AAAA", playerCount: 3 },
      { roomCode: "BBBB", playerCount: 4 },
    ];
    ev.detail.game_abandoned = [{ phase: "rating" }, { phase: "rating" }, { phase: "lobby" }, {}];
    const join = (roomCode: string, playerId: string, visitorId?: string): SlimEvent => ({
      roomCode,
      playerId,
      ...(visitorId ? { visitorId } : {}),
    });
    ev.detail.player_joined = [
      join("AAAA", "p1", "v1"),
      join("AAAA", "p2", "v2"),
      join("AAAA", "p3"), // legacy client, no visitor id
      join("BBBB", "p4", "v1"), // v1 plays a second game: still one player
      join("CCCC", "p5", "v3"),
      join("DDDD", "p6", "v4"), // joined a room that never started
    ];
    ev.detail.search_no_results = [
      { label: "Obscure Song" },
      { label: "obscure  song " },
      { label: "other" },
      {},
    ];

    const row = computeDayMetrics(inputs({ events: ev, pageviews: 50, uniqueVisitors: 20, newVisitors: 8 }));
    expect(row).toMatchObject({
      gamesCreated: 4,
      gamesStarted: 3,
      gamesCompleted: 2,
      gamesAbandoned: 4,
      abandonedByPhase: { rating: 2, lobby: 1, unknown: 1 },
      completionRate: 0.6667,
      playerJoins: 6,
      uniquePlayers: 5, // v1, v2, p3, v3, v4
      joinsWithVisitorId: 5,
      playersInStartedGames: 4, // v1, v2, p3, v3
      playersInCompletedGames: 3, // v1, v2, p3
      playerSeatsCompleted: 7,
      avgPlayersPerGame: 3.33,
      p90PlayersPerGame: 5,
      maxPlayersPerGame: 5,
      songsSubmitted: 30,
      ratingsSubmitted: 90,
      proPurchases: 1,
      searchNoResults: 4,
      topNoResultSearches: [
        { query: "obscure song", count: 2 },
        { query: "other", count: 1 },
      ],
      newVisitors: 8,
      returningVisitors: 12,
    });
  });

  test("counts failed searches by reason, separately from empty results", () => {
    const ev = emptyEvents();
    ev.detail.search_no_results = [{ label: "a" }];
    ev.detail.search_failed = [
      { reason: "network" },
      { reason: "network" },
      { reason: "timeout" },
      { reason: "http_503" },
      { reason: "junk value" },
      {},
    ];
    const row = computeDayMetrics(inputs({ events: ev }));
    expect(row.searchNoResults).toBe(1);
    expect(row.searchFailed).toBe(6);
    expect(row.searchFailedByReason).toEqual({ network: 2, timeout: 1, http_503: 1, unknown: 2 });
  });

  test("no failed searches reads zero with an empty breakdown", () => {
    const row = computeDayMetrics(inputs());
    expect(row.searchFailed).toBe(0);
    expect(row.searchFailedByReason).toEqual({});
  });

  test("completion rate is capped at 1 when games started the day before finish", () => {
    const ev = emptyEvents();
    ev.detail.game_started = [{ roomCode: "A", playerCount: 2 }];
    ev.detail.game_completed = [{ roomCode: "A" }, { roomCode: "B" }];
    expect(computeDayMetrics(inputs({ events: ev })).completionRate).toBe(1);
  });

  test("peaks come from hour rows; sampling on but empty day is zero", () => {
    const row = computeDayMetrics(
      inputs({
        hours: [
          { hourUTC: 21, playersOnline: 7, playersInGame: 6 },
          { hourUTC: 3, playersOnline: 9, playersInGame: 2 },
          { hourUTC: 22, playersOnline: 9, playersInGame: 8 },
        ],
      })
    );
    expect(row).toMatchObject({ peakPlayersOnline: 9, peakPlayersInGame: 8, peakHourUTC: 3 });
    expect(row.hourlyPeaks.map((h) => h.hourUTC)).toEqual([3, 21, 22]);

    expect(computeDayMetrics(inputs({ hours: [] }))).toMatchObject({
      peakPlayersOnline: 0,
      peakPlayersInGame: 0,
      peakHourUTC: null,
    });
  });
});

describe("rollupDay", () => {
  // A fixed past date with a full history around it.
  const now = Date.now();
  const D = addDays(dstr(now), -10);
  const at = (date: string, hour: number) => dayStartMs(date) + hour * HOUR;

  async function seed(t: ReturnType<typeof setup>) {
    await t.run(async (ctx) => {
      const ev = async (eventType: string, timestamp: number, metadata?: Record<string, unknown>) =>
        ctx.db.insert("analyticsEvents", { eventType, timestamp, metadata });
      await ev("game_created", at(D, 1), { roomCode: "QAROOM" });
      await ev("player_joined", at(D, 1), { roomCode: "QAROOM", playerId: "p1", visitorId: "v-new" });
      await ev("player_joined", at(D, 1), { roomCode: "QAROOM", playerId: "p2", visitorId: "v-old" });
      await ev("game_started", at(D, 2), { roomCode: "QAROOM", playerCount: 2 });
      await ev("song_submitted", at(D, 2), { roomCode: "QAROOM" });
      await ev("rating_submitted", at(D, 2), { roomCode: "QAROOM" });
      await ev("game_completed", at(D, 3), { roomCode: "QAROOM", playerCount: 2 });
      // Outside the day on both sides: must not be counted.
      await ev("game_started", at(D, 0) - 1, { roomCode: "QABFOR", playerCount: 9 });
      await ev("game_started", at(D, 24), { roomCode: "QAAFTR", playerCount: 9 });

      // day: split across a legacy row and a shard; uvday: one shard.
      await ctx.db.insert("pageviewCounters", { key: `day:${D}`, count: 5 });
      await ctx.db.insert("pageviewCounters", { key: `day:${D}`, count: 7, shard: 3 });
      await ctx.db.insert("pageviewCounters", { key: `uvday:${D}`, count: 3, shard: 0 });

      // Visitor history: v-old first seen long before D; v-new and v-bounce new on D.
      await ctx.db.insert("visitorFirstSeen", { visitorId: "v-old", firstSeenDate: addDays(D, -40), firstPlayedDate: addDays(D, -40) });
      await ctx.db.insert("visitorFirstSeen", { visitorId: "v-new", firstSeenDate: D, firstPlayedDate: D });
      await ctx.db.insert("visitorFirstSeen", { visitorId: "v-bounce", firstSeenDate: D });
      // v-new comes back the next day; v-bounce never does.
      await ctx.db.insert("pageviewVisits", { date: addDays(D, 1), visitorId: "v-new" });
      await ctx.db.insert("pageviewVisits", { date: addDays(D, 7), visitorId: "v-bounce" });

      // Concurrency sampling started before D.
      await ctx.db.insert("concurrencyStats", {
        kind: "hour",
        hourStart: at(addDays(D, -1), 5),
        date: addDays(D, -1),
        hourUTC: 5,
        playersOnline: 1,
        playersInGame: 0,
        activeRooms: 1,
        activeGames: 0,
        updatedAt: 0,
      });
      await ctx.db.insert("concurrencyStats", {
        kind: "hour",
        hourStart: at(D, 2),
        date: D,
        hourUTC: 2,
        playersOnline: 2,
        playersInGame: 2,
        activeRooms: 1,
        activeGames: 1,
        updatedAt: 0,
      });
    });
  }

  async function rowFor(t: ReturnType<typeof setup>, date: string) {
    return await t.run(async (ctx) =>
      ctx.db
        .query("dailyMetrics")
        .withIndex("by_date", (q) => q.eq("date", date))
        .unique()
    );
  }

  test("builds the row, fills retention, and is idempotent", async () => {
    const t = setup();
    await seed(t);

    const first = await t.action(internal.dailyMetrics.rollupDay, { date: D });
    expect(first.action).toBe("inserted");

    const row = await rowFor(t, D);
    expect(row).toMatchObject({
      gamesCreated: 1,
      gamesStarted: 1,
      gamesCompleted: 1,
      completionRate: 1,
      playerJoins: 2,
      uniquePlayers: 2,
      joinsWithVisitorId: 2,
      playersInCompletedGames: 2,
      songsSubmitted: 1,
      ratingsSubmitted: 1,
      pageviews: 12,
      uniqueVisitors: 3,
      newVisitors: 2,
      returningVisitors: 1,
      newVisitorsPlayed: 1,
      newPlayers: 1,
      peakPlayersOnline: 2,
      peakPlayersInGame: 2,
      peakHourUTC: 2,
      retention: {
        d1: { cohort: 2, returned: 1 },
        d7: { cohort: 2, returned: 1 },
      },
    });
    // D+30 has not happened yet.
    expect(row!.retention!.d30).toBeUndefined();

    const second = await t.action(internal.dailyMetrics.rollupDay, { date: D });
    expect(second.action).toBe("replaced");
    const rows = await t.run(async (ctx) => ctx.db.query("dailyMetrics").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0].retention).toEqual(row!.retention);
  });

  test("rolling up the check day patches an existing cohort row", async () => {
    const t = setup();
    await seed(t);
    await t.action(internal.dailyMetrics.rollupDay, { date: D });
    // Clear D's retention, then roll up D+1: it must refill d1.
    await t.run(async (ctx) => {
      const r = await ctx.db
        .query("dailyMetrics")
        .withIndex("by_date", (q) => q.eq("date", D))
        .unique();
      await ctx.db.patch(r!._id, { retention: undefined });
    });
    const res = await t.action(internal.dailyMetrics.rollupDay, { date: addDays(D, 1) });
    expect(res.cohortRowsPatched).toBe(1);
    expect((await rowFor(t, D))!.retention).toEqual({ d1: { cohort: 2, returned: 1 } });
  });

  test("dates before visitor or concurrency history read as unknown", async () => {
    const t = setup();
    await seed(t);
    const early = addDays(D, -50);
    await t.action(internal.dailyMetrics.rollupDay, { date: early });
    expect(await rowFor(t, early)).toMatchObject({
      newVisitors: null,
      returningVisitors: null,
      newPlayers: null,
      peakPlayersOnline: null,
      gamesStarted: 0,
    });
  });

  test("refuses today and malformed dates", async () => {
    const t = setup();
    await expect(t.action(internal.dailyMetrics.rollupDay, { date: dstr(Date.now()) })).rejects.toThrow();
    await expect(t.action(internal.dailyMetrics.rollupDay, { date: "2026-13-40" })).rejects.toThrow();
  });

  test("backfill schedules every day with raw events up to yesterday", async () => {
    // Fake timers keep the scheduled rollups from running after the test.
    vi.useFakeTimers();
    try {
      const t = setup();
      const oldest = dayStartMs(addDays(dstr(Date.now()), -5)) + 12 * HOUR;
      await t.run(async (ctx) => {
        await ctx.db.insert("analyticsEvents", { eventType: "game_created", timestamp: oldest });
      });
      const res = await t.mutation(internal.dailyMetrics.backfillDailyMetrics, { spacingMs: 0 });
      expect(res).toEqual({
        scheduled: 5,
        from: addDays(dstr(Date.now()), -5),
        to: addDays(dstr(Date.now()), -1),
      });
      const scheduled = await t.run(async (ctx) => ctx.db.system.query("_scheduled_functions").collect());
      expect(scheduled.map((s) => s.args[0].date)).toEqual([
        addDays(dstr(Date.now()), -5),
        addDays(dstr(Date.now()), -4),
        addDays(dstr(Date.now()), -3),
        addDays(dstr(Date.now()), -2),
        addDays(dstr(Date.now()), -1),
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
