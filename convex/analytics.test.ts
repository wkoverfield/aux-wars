import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import presenceComponent from "@convex-dev/presence/test";
import {
  LISTEN_MS_SAMPLES,
  LISTEN_MS_TOTAL,
  sanitizeClientError,
  sanitizeWebVital,
  searchFailReason,
} from "./analytics";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./**/*.d.ts"]);
const DAY = 24 * 60 * 60 * 1000;

function setup() {
  const t = convexTest(schema, modules);
  presenceComponent.register(t, "presence");
  return t;
}

const dateOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const dayStart = (ms: number) => Math.floor(ms / DAY) * DAY;

async function insertEvents(t: ReturnType<typeof setup>, timestamps: number[]) {
  await t.run(async (ctx) => {
    for (const timestamp of timestamps) {
      await ctx.db.insert("analyticsEvents", { eventType: "rating_submitted", timestamp });
    }
  });
}

async function markRolledUp(t: ReturnType<typeof setup>, dates: string[]) {
  await t.run(async (ctx) => {
    for (const date of dates) {
      await ctx.db.insert("dailyMetrics", {
        date,
        computedAt: 0,
        gamesCreated: 0,
        gamesStarted: 0,
        gamesCompleted: 0,
        gamesAbandoned: 0,
        abandonedByPhase: {},
        completionRate: null,
        playerJoins: 0,
        uniquePlayers: 0,
        joinsWithVisitorId: 0,
        playersInStartedGames: 0,
        playersInCompletedGames: 0,
        playerSeatsCompleted: 0,
        avgPlayersPerGame: null,
        p90PlayersPerGame: null,
        maxPlayersPerGame: null,
        songsSubmitted: 0,
        ratingsSubmitted: 0,
        pageviews: 0,
        uniqueVisitors: 0,
        newVisitors: null,
        returningVisitors: null,
        newVisitorsPlayed: null,
        newPlayers: null,
        peakPlayersOnline: null,
        peakPlayersInGame: null,
        peakHourUTC: null,
        proPurchases: 0,
        searchNoResults: 0,
        topNoResultSearches: [],
        hourlyPeaks: [],
      });
    }
  });
}

const remaining = (t: ReturnType<typeof setup>) =>
  t.run(async (ctx) => (await ctx.db.query("analyticsEvents").collect()).map((e) => e.timestamp).sort());

describe("cleanupOldEvents", () => {
  test("drains a backlog in batches until nothing old is left", async () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      const now = Date.now();
      const oldDay1 = dayStart(now - 100 * DAY);
      const oldDay2 = oldDay1 + DAY;
      const old = [
        ...Array.from({ length: 13 }, (_, i) => oldDay1 + i * 1000),
        ...Array.from({ length: 12 }, (_, i) => oldDay2 + i * 1000),
      ];
      const fresh = [now - DAY, now - 2 * DAY];
      await insertEvents(t, [...old, ...fresh]);
      await markRolledUp(t, [dateOf(oldDay1), dateOf(oldDay2)]);

      const first = await t.mutation(internal.analytics.cleanupOldEvents, { retentionDays: 90, batchSize: 10 });
      expect(first).toMatchObject({ deleted: 10, more: true });
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      expect(await remaining(t)).toEqual([...fresh].sort());
    } finally {
      vi.useRealTimers();
    }
  });

  test("never deletes a day that has no rollup row", async () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      const now = Date.now();
      const d1 = dayStart(now - 100 * DAY);
      const d2 = d1 + DAY; // not rolled up
      const d3 = d1 + 2 * DAY; // rolled up, but after the gap
      await insertEvents(t, [d1 + 5, d2 + 5, d3 + 5]);
      await markRolledUp(t, [dateOf(d1), dateOf(d3)]);

      const res = await t.mutation(internal.analytics.cleanupOldEvents, { retentionDays: 90 });
      expect(res).toMatchObject({ deleted: 1, before: d2, more: false });
      expect(await remaining(t)).toEqual([d2 + 5, d3 + 5]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("with no rollups at all it deletes nothing", async () => {
    const t = setup();
    await insertEvents(t, [Date.now() - 200 * DAY]);
    const res = await t.mutation(internal.analytics.cleanupOldEvents, { retentionDays: 90 });
    expect(res.deleted).toBe(0);
  });
});

describe("vote_listen", () => {
  test("counts in aggregates without writing raw rows", async () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      await t.mutation(api.analytics.logEvent, { eventType: "vote_listen", metadata: { value: 4000 } });
      await t.mutation(api.analytics.logEvent, { eventType: "vote_listen", metadata: { value: 8000 } });
      await t.mutation(api.analytics.logEvent, { eventType: "vote_listen", metadata: { value: 1e12 } });
      await t.mutation(api.analytics.logEvent, { eventType: "vote_listen" });
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      const raw = await t.run(async (ctx) => ctx.db.query("analyticsEvents").collect());
      expect(raw).toHaveLength(0);
      const aggs = await t.run(async (ctx) => ctx.db.query("analyticsAggregates").collect());
      const byType = Object.fromEntries(aggs.map((a) => [a.eventType, a.count]));
      expect(byType).toEqual({
        vote_listen: 4,
        [LISTEN_MS_TOTAL]: 4000 + 8000 + 600000, // third value clamped to 10 minutes
        [LISTEN_MS_SAMPLES]: 3,
      });
      const stats = await t.query(internal.analytics.getListenTimeStats, {});
      expect(stats).toMatchObject({ count: 0, allTimeSamples: 3, allTimeAvgSec: 204 });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("search_failed", () => {
  test("searchFailReason keeps known classes only", () => {
    for (const r of ["timeout", "network", "bad_payload", "http_503", "http_404"]) {
      expect(searchFailReason(r)).toBe(r);
    }
    for (const r of [undefined, "", "http_5", "http_abc", "my song title", "network "]) {
      expect(searchFailReason(r)).toBe("unknown");
    }
  });

  test("logEvent stores only the sanitized reason", async () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      await t.mutation(api.analytics.logEvent, {
        eventType: "search_failed",
        metadata: { reason: "http_503", label: "query text must not be stored" },
      });
      await t.mutation(api.analytics.logEvent, { eventType: "search_failed", metadata: { reason: "<script>" } });
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      const raw = await t.run(async (ctx) => ctx.db.query("analyticsEvents").collect());
      expect(raw.map((e) => [e.eventType, e.metadata])).toEqual([
        ["search_failed", { reason: "http_503" }],
        ["search_failed", { reason: "unknown" }],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("web_vital and client errors", () => {
  test("sanitizeWebVital keeps INP attribution only in its known shapes", () => {
    expect(
      sanitizeWebVital({
        name: "INP", value: 312.4, rating: "poor", route: "/lobby/:code/round", deviceClass: "mobile",
        target: "rating>record:button", interactionType: "pointer",
        inputDelay: 12.6, processing: 250.2, presentation: 49.9, script: "app",
      })
    ).toEqual({
      name: "INP", value: 312, rating: "poor", route: "/lobby/:code/round", deviceClass: "mobile",
      target: "rating>record:button", interactionType: "pointer",
      inputDelay: 13, processing: 250, presentation: 50, script: "app",
    });
    const junk = sanitizeWebVital({
      name: "INP", value: 300, target: "Velvet Bassline's button", interactionType: "hover",
      inputDelay: -1, processing: Number.NaN, script: "https://evil.example/x.js",
    });
    expect(junk).not.toHaveProperty("target");
    expect(junk).not.toHaveProperty("interactionType");
    expect(junk).not.toHaveProperty("inputDelay");
    expect(junk).not.toHaveProperty("processing");
    expect(junk).not.toHaveProperty("script");
    // Attribution belongs to INP only.
    expect(sanitizeWebVital({ name: "LCP", value: 2000, target: "home:img" })).not.toHaveProperty("target");
  });

  test("sanitizeWebVital keeps known fields and rounds values", () => {
    expect(
      sanitizeWebVital({
        name: "LCP",
        value: 2512.7,
        rating: "needs-improvement",
        route: "/lobby/:code",
        deviceClass: "chromebook",
        effectiveType: "4g",
        label: "dropped",
      })
    ).toEqual({
      name: "LCP",
      value: 2513,
      rating: "needs-improvement",
      route: "/lobby/:code",
      deviceClass: "chromebook",
      effectiveType: "4g",
    });
    expect(sanitizeWebVital({ name: "CLS", value: 0.12345, rating: "x", route: "/lobby/ABC123?x=1", deviceClass: "tv" }))
      .toEqual({ name: "CLS", value: 0.123, rating: "unknown", route: "other", deviceClass: "unknown" });
    expect(sanitizeWebVital({ name: "LCP", value: 1e9 })?.value).toBe(120_000);
    expect(sanitizeWebVital({ name: "FID", value: 10 })).toBeNull();
    expect(sanitizeWebVital({ name: "LCP", value: Number.NaN })).toBeNull();
    expect(sanitizeWebVital({ name: "LCP", value: -1 })).toBeNull();
    expect(sanitizeWebVital(undefined)).toBeNull();
  });

  test("sanitizeClientError keeps only the error class name and route", () => {
    expect(sanitizeClientError({ name: "TypeError", route: "/", label: "secret message" })).toEqual({
      name: "TypeError",
      route: "/",
    });
    expect(sanitizeClientError({ name: "Cannot read properties of undefined", route: "https://x" })).toEqual({
      name: "Error",
      route: "other",
    });
    expect(sanitizeClientError(undefined)).toEqual({ name: "Error", route: "other" });
  });

  test("logEvent stores sanitized vitals and errors, rejects bad metrics", async () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      const ok = await t.mutation(api.analytics.logEvent, {
        eventType: "web_vital",
        metadata: { name: "INP", value: 180.4, rating: "good", route: "/", deviceClass: "mobile" },
      });
      expect(ok.success).toBe(true);
      const bad = await t.mutation(api.analytics.logEvent, {
        eventType: "web_vital",
        metadata: { name: "nope", value: 1 },
      });
      expect(bad.success).toBe(false);
      await t.mutation(api.analytics.logEvent, {
        eventType: "client_error",
        metadata: { name: "RangeError", route: "/lobby/:code/round", label: "stack text" },
      });
      await t.mutation(api.analytics.logEvent, {
        eventType: "client_error_boundary",
        metadata: { name: "TypeError", route: "/stats" },
      });
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      const raw = await t.run(async (ctx) => ctx.db.query("analyticsEvents").collect());
      expect(raw.map((e) => [e.eventType, e.metadata])).toEqual([
        ["web_vital", { name: "INP", value: 180, rating: "good", route: "/", deviceClass: "mobile" }],
        ["client_error", { name: "RangeError", route: "/lobby/:code/round" }],
        ["client_error_boundary", { name: "TypeError", route: "/stats" }],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
