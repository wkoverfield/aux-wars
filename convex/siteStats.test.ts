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

  test("room codes and results ids never reach the per-path counters, whatever the case", async () => {
    const t = setup();
    for (const path of ["/lobby/QAROOM", "/LOBBY/QAROOM/round", "/g/abcdefgh2345", "/G/abcdefgh2345"]) {
      await t.mutation(api.siteStats.recordPageview, { path, visitorId: "qa-visitor" });
    }
    const keys = await t.run(async (ctx) => (await ctx.db.query("pageviewCounters").collect()).map((r) => r.key));
    const paths = keys.filter((k) => k.startsWith("path:")).sort();
    expect([...new Set(paths)]).toEqual(["path:/g/:id", "path:/lobby/:code", "path:/lobby/:code/round"]);
    expect(keys.join(" ")).not.toMatch(/QAROOM|abcdefgh2345/);
  });

  test("a join records whether it came from an invite link or the code box", async () => {
    vi.useFakeTimers();
    try {
      const t = setup();
      const { code } = await t.mutation(api.game.rooms.hostGame, {});
      const join = (playerId: string, extra: Record<string, unknown> = {}) =>
        t.mutation(api.game.rooms.joinGame, { code, playerId, connectionId: `c-${playerId}`, name: `QA-${playerId}`, ...extra });
      expect((await join("qa-host")).success).toBe(true);
      expect((await join("qa-link", { source: "link" })).success).toBe(true);
      expect((await join("qa-code", { source: "code" })).success).toBe(true);
      await t.finishAllScheduledFunctions(vi.runAllTimers);

      const joins = await t.run(async (ctx) =>
        ctx.db
          .query("analyticsEvents")
          .withIndex("by_type", (q) => q.eq("eventType", "player_joined"))
          .collect()
      );
      expect(joins.map((j) => [j.metadata.playerId, j.metadata.source])).toEqual([
        ["qa-host", undefined],
        ["qa-link", "link"],
        ["qa-code", "code"],
      ]);
      // Anything else is rejected by the argument validator.
      await expect(join("qa-bad", { source: "telepathy" })).rejects.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });
  test("a private seat joined with a seat key cannot be taken over by its player id alone", async () => {
    const t = setup();
    const { code } = await t.mutation(api.game.rooms.hostGame, {});
    const key = "qa-seat-key-0123456789abcdef0123456789abcdef";
    const join = (extra: Record<string, unknown>) =>
      t.mutation(api.game.rooms.joinGame, { code, playerId: "qa-victim", name: "QA-victim", connectionId: "c-own", ...extra });
    expect(await join({ seatKey: key })).toMatchObject({ success: true, tookOver: false });

    // Another player in the room can read "qa-victim" from the player list.
    expect(await join({ connectionId: "c-attacker" })).toMatchObject({ success: false });
    expect(await join({ connectionId: "c-attacker", seatKey: "qa-wrong-key-0123456789abcdef0123456789" })).toMatchObject({ success: false });
    const seat = await t.run(async (ctx) =>
      ctx.db.query("players").withIndex("by_player", (q) => q.eq("playerId", "qa-victim").eq("roomCode", code)).unique()
    );
    expect(seat?.connectionId).toBe("c-own");

    // The key holder still can.
    expect(await join({ connectionId: "c-own-2", seatKey: key })).toMatchObject({ success: true, tookOver: true });
  });
});

