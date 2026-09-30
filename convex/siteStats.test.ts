import { convexTest } from "convex-test";
import { describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import presenceComponent from "@convex-dev/presence/test";
import { PAGEVIEW_SHARDS, readCounter } from "./siteStats";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./**/*.d.ts"]);

function setup() {
  const t = convexTest(schema, modules);
  presenceComponent.register(t, "presence");
  return t;
}

const today = () => new Date().toISOString().slice(0, 10);

describe("sharded pageview counters", () => {
  test("pageviews spread over shards and reads sum them", async () => {
    const t = setup();
    for (let i = 0; i < 40; i++) {
      await t.mutation(api.siteStats.recordPageview, { path: "/", visitorId: `qa-v${i % 5}` });
    }
    const rows = await t.run(async (ctx) => ctx.db.query("pageviewCounters").collect());
    const totalRows = rows.filter((r) => r.key === "total");
    expect(totalRows.length).toBeGreaterThan(1);
    expect(totalRows.length).toBeLessThanOrEqual(PAGEVIEW_SHARDS);
    expect(totalRows.every((r) => typeof r.shard === "number")).toBe(true);

    const sums = await t.run(async (ctx) => ({
      total: await readCounter(ctx, "total"),
      path: await readCounter(ctx, "path:/"),
      day: await readCounter(ctx, `day:${today()}`),
      uv: await readCounter(ctx, `uvday:${today()}`),
    }));
    expect(sums).toEqual({ total: 40, path: 40, day: 40, uv: 5 });

    const dash = await t.query(internal.siteStats.getDashboard, {});
    expect(dash.pageviews.total).toBe(40);
    expect(dash.pageviews.byDay[0]).toEqual({ date: today(), views: 40, uniques: 5 });
    expect(dash.topPages).toEqual([{ path: "/", views: 40 }]);
  });

  test("migration folds legacy rows into shard 0 with identical totals", async () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      const date = today();
      // Legacy single rows, plus a shard written after deploy but before migrating.
      await t.run(async (ctx) => {
        await ctx.db.insert("pageviewCounters", { key: "total", count: 1000 });
        await ctx.db.insert("pageviewCounters", { key: "path:/", count: 700 });
        await ctx.db.insert("pageviewCounters", { key: `day:${date}`, count: 30 });
        await ctx.db.insert("pageviewCounters", { key: `uvday:${date}`, count: 9 });
        await ctx.db.insert("pageviewCounters", { key: "total", count: 4, shard: 0 });
        await ctx.db.insert("pageviewCounters", { key: "total", count: 2, shard: 5 });
      });

      const snapshotBefore = await t.mutation(internal.metricsRollup.snapshotDailyMetrics, {});
      const readSnap = () =>
        t.run(async (ctx) => (await ctx.db.query("metricSnapshots").first())!.metrics);
      const metricsBefore = await readSnap();
      const dashBefore = await t.query(internal.siteStats.getDashboard, {});
      expect(metricsBefore["pageviews:total"]).toBe(1006);

      // Batch size 2 forces the migration to reschedule itself.
      const first = await t.mutation(internal.siteStats.migratePageviewShards, { batchSize: 2 });
      expect(first.more).toBe(true);
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      const rows = await t.run(async (ctx) => ctx.db.query("pageviewCounters").collect());
      expect(rows.every((r) => r.shard !== undefined)).toBe(true);
      expect(rows.find((r) => r.key === "total" && r.shard === 0)!.count).toBe(1004);

      await t.mutation(internal.metricsRollup.snapshotDailyMetrics, {});
      expect(await readSnap()).toEqual(metricsBefore);
      const dashAfter = await t.query(internal.siteStats.getDashboard, {});
      expect(dashAfter.pageviews).toEqual(dashBefore.pageviews);
      expect(dashAfter.uniques).toEqual(dashBefore.uniques);
      expect(dashAfter.topPages).toEqual(dashBefore.topPages);
      expect(await t.query(api.siteStats.publicImpact, {})).toMatchObject({ asOf: snapshotBefore.date });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("visitor identity", () => {
  test("pageview records firstSeenDate once; anon is ignored", async () => {
    const t = setup();
    await t.mutation(api.siteStats.recordPageview, { path: "/", visitorId: "qa-visitor" });
    await t.mutation(api.siteStats.recordPageview, { path: "/about", visitorId: "qa-visitor" });
    await t.mutation(api.siteStats.recordPageview, { path: "/", visitorId: "anon" });
    const rows = await t.run(async (ctx) => ctx.db.query("visitorFirstSeen").collect());
    expect(rows).toEqual([expect.objectContaining({ visitorId: "qa-visitor", firstSeenDate: today() })]);
  });

  test("join with visitorId sets firstPlayedDate; old clients still join", async () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      const { code } = await t.mutation(api.game.rooms.hostGame, { visitorId: "qa-host-v" });
      const host = await t.mutation(api.game.rooms.joinGame, {
        code,
        playerId: "qa-p1",
        connectionId: "c1",
        name: "QA-host",
        visitorId: "qa-host-v",
      });
      const legacy = await t.mutation(api.game.rooms.joinGame, {
        code,
        playerId: "qa-p2",
        connectionId: "c2",
        name: "QA-legacy",
      });
      expect(host.success).toBe(true);
      expect(legacy.success).toBe(true);
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      const seen = await t.run(async (ctx) => ctx.db.query("visitorFirstSeen").collect());
      expect(seen).toEqual([
        expect.objectContaining({ visitorId: "qa-host-v", firstSeenDate: today(), firstPlayedDate: today() }),
      ]);
      const joins = await t.run(async (ctx) =>
        ctx.db
          .query("analyticsEvents")
          .withIndex("by_type", (q) => q.eq("eventType", "player_joined"))
          .collect()
      );
      expect(joins.map((j) => j.metadata.visitorId)).toEqual(["qa-host-v", undefined]);
    } finally {
      vi.useRealTimers();
    }
  });
});
