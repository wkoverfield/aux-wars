import { convexTest } from "convex-test";
import { afterEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import presenceComponent from "@convex-dev/presence/test";
import { constantTimeEqual, isValidAdminKey } from "./stats";
import { addDays, dstr } from "./dailyMetrics";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./**/*.d.ts"]);
const KEY = "qa-test-admin-key-0123456789";

function setup() {
  const t = convexTest(schema, modules);
  presenceComponent.register(t, "presence");
  return t;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("admin key check", () => {
  test("constantTimeEqual", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
    expect(constantTimeEqual("", "")).toBe(true);
  });

  test("isValidAdminKey rejects missing env, empty env, empty and wrong keys", () => {
    expect(isValidAdminKey(KEY, undefined)).toBe(false);
    expect(isValidAdminKey(KEY, "")).toBe(false);
    expect(isValidAdminKey("", KEY)).toBe(false);
    expect(isValidAdminKey("", "")).toBe(false);
    expect(isValidAdminKey(KEY + "x", KEY)).toBe(false);
    expect(isValidAdminKey(undefined, KEY)).toBe(false);
    expect(isValidAdminKey(KEY, KEY)).toBe(true);
  });
});

describe("stats queries", () => {
  test("checkKey reports without throwing", async () => {
    const t = setup();
    vi.stubEnv("STATS_ADMIN_KEY", "");
    expect(await t.query(api.stats.checkKey, { adminKey: KEY })).toEqual({ ok: false });
    vi.stubEnv("STATS_ADMIN_KEY", KEY);
    expect(await t.query(api.stats.checkKey, { adminKey: "" })).toEqual({ ok: false });
    expect(await t.query(api.stats.checkKey, { adminKey: "wrong" })).toEqual({ ok: false });
    expect(await t.query(api.stats.checkKey, { adminKey: KEY })).toEqual({ ok: true });
  });

  test("getLive and getDashboard throw without a valid key", async () => {
    const t = setup();
    vi.stubEnv("STATS_ADMIN_KEY", "");
    await expect(t.query(api.stats.getLive, { adminKey: KEY })).rejects.toThrow(/Unauthorized/);
    await expect(t.query(api.stats.getDashboard, { adminKey: KEY, days: 7 })).rejects.toThrow(/Unauthorized/);
    vi.stubEnv("STATS_ADMIN_KEY", KEY);
    await expect(t.query(api.stats.getLive, { adminKey: "nope" })).rejects.toThrow(/Unauthorized/);
    await expect(t.query(api.stats.getDashboard, { adminKey: "", days: 30 })).rejects.toThrow(/Unauthorized/);
  });

  test("getLive returns nulls before the first sample", async () => {
    const t = setup();
    vi.stubEnv("STATS_ADMIN_KEY", KEY);
    const live = await t.query(api.stats.getLive, { adminKey: KEY });
    expect(live).toEqual({
      playersOnline: null,
      playersInGame: null,
      activeRooms: null,
      activeGames: null,
      sampledAt: null,
      allTimePeak: null,
    });
  });

  test("getLive reads the stored rows and never samples rooms itself", async () => {
    const t = setup();
    vi.stubEnv("STATS_ADMIN_KEY", KEY);
    const sampledAt = Date.UTC(2026, 8, 30, 20, 5);
    await t.run(async (ctx) => {
      await ctx.db.insert("concurrencyStats", {
        kind: "latest",
        hourStart: 0,
        playersOnline: 7,
        playersInGame: 5,
        activeRooms: 2,
        activeGames: 1,
        updatedAt: sampledAt,
      });
      await ctx.db.insert("concurrencyStats", {
        kind: "allTime",
        hourStart: 0,
        playersOnline: 30,
        playersInGame: 22,
        activeRooms: 6,
        activeGames: 4,
        playersOnlineAt: sampledAt - 5000,
        updatedAt: sampledAt - 5000,
      });
      // A live room with seated players: getLive must not count it.
      await ctx.db.insert("rooms", {
        code: "QALIVE",
        phase: "rating",
        currentRound: 1,
        settings: { numberOfRounds: 3, roundLength: 60, snippetDuration: 30, selectedPrompts: ["a"] },
        createdAt: Date.now(),
        lastActivityAt: Date.now(),
      });
      await ctx.db.insert("players", { roomCode: "QALIVE", playerId: "p", name: "QA-p", isHost: true, isReady: false });
    });
    const live = await t.query(api.stats.getLive, { adminKey: KEY });
    expect(live).toEqual({
      playersOnline: 7,
      playersInGame: 5,
      activeRooms: 2,
      activeGames: 1,
      sampledAt,
      allTimePeak: { playersOnline: 30, playersInGame: 22, at: sampledAt - 5000, playersInGameAt: null },
    });
  });

  test("getDashboard aggregates rollup rows over the window", async () => {
    const t = setup();
    vi.stubEnv("STATS_ADMIN_KEY", KEY);
    const today = dstr(Date.now());
    const base = {
      computedAt: 0,
      gamesCreated: 1,
      gamesStarted: 1,
      gamesCompleted: 1,
      gamesAbandoned: 1,
      completionRate: 1,
      playerJoins: 2,
      uniquePlayers: 2,
      joinsWithVisitorId: 2,
      playersInStartedGames: 2,
      playersInCompletedGames: 1,
      playerSeatsCompleted: 2,
      avgPlayersPerGame: 2,
      p90PlayersPerGame: 2,
      maxPlayersPerGame: 2,
      songsSubmitted: 6,
      ratingsSubmitted: 12,
      pageviews: 10,
      uniqueVisitors: 5,
      newVisitors: 3,
      returningVisitors: 2,
      newVisitorsPlayed: 1,
      newPlayers: 1,
      peakPlayersOnline: 2,
      peakPlayersInGame: 2,
      peakHourUTC: 20,
      proPurchases: 0,
      searchNoResults: 1,
    };
    await t.run(async (ctx) => {
      await ctx.db.insert("dailyMetrics", {
        ...base,
        date: addDays(today, -2),
        abandonedByPhase: { rating: 1 },
        topNoResultSearches: [{ query: "song a", count: 2 }],
        searchFailed: 3,
        searchFailedByReason: { network: 2, timeout: 1 },
        hourlyPeaks: [{ hourUTC: 20, playersOnline: 2, playersInGame: 2 }],
        retention: { d1: { cohort: 3, returned: 1 } },
      });
      await ctx.db.insert("dailyMetrics", {
        ...base,
        date: addDays(today, -3),
        abandonedByPhase: { rating: 2, lobby: 1 },
        topNoResultSearches: [
          { query: "song a", count: 1 },
          { query: "song b", count: 5 },
        ],
        searchFailed: 1,
        searchFailedByReason: { http_503: 1 },
        hourlyPeaks: [{ hourUTC: 20, playersOnline: 4, playersInGame: 1 }],
        retention: { d1: { cohort: 1, returned: 1 } },
      });
      // Outside the 7-day window: ignored for trends and funnel.
      await ctx.db.insert("dailyMetrics", {
        ...base,
        date: addDays(today, -20),
        abandonedByPhase: { rating: 50 },
        topNoResultSearches: [],
        hourlyPeaks: [{ hourUTC: 20, playersOnline: 99, playersInGame: 99 }],
      });
    });

    const d = await t.query(api.stats.getDashboard, { adminKey: KEY, days: 7 });
    expect(d.days.map((r) => r.date)).toEqual([addDays(today, -3), addDays(today, -2)]);
    expect(d.hourlyPeaks).toHaveLength(24);
    expect(d.hourlyPeaks[20]).toEqual({ hourUTC: 20, playersOnline: 4, playersInGame: 2 });
    expect(d.funnel).toEqual({ visited: 10, joined: 4, started: 4, completed: 2 });
    expect(d.retention).toMatchObject({ d1: 0.5, d7: null, d30: null, cohortSize: 4 });
    expect(d.topNoResultSearches).toEqual([
      { query: "song b", count: 5 },
      { query: "song a", count: 3 },
    ]);
    // Rows without the optional search-failure fields count as zero.
    expect(d.searches).toEqual({
      noResults: 2,
      failed: 4,
      failedByReason: [
        { reason: "network", count: 2 },
        { reason: "http_503", count: 1 },
        { reason: "timeout", count: 1 },
      ],
    });
    expect(d.abandonmentByPhase).toEqual([
      { phase: "rating", count: 3 },
      { phase: "lobby", count: 1 },
    ]);
    expect(d.today).toMatchObject({ date: today, partial: true, songsSubmitted: null, gamesStarted: 0 });
  });
});
