import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import presenceComponent from "@convex-dev/presence/test";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./**/*.d.ts"]);

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

async function visitors(t: ReturnType<typeof setup>) {
  return await t.run(async (ctx) => ctx.db.query("visitorFirstSeen").collect());
}

test("pageview records first seen once; join records first played once", async () => {
  const t = setup();
  const today = new Date().toISOString().slice(0, 10);

  await t.mutation(api.siteStats.recordPageview, { path: "/", visitorId: "v-qa-1" });
  await t.mutation(api.siteStats.recordPageview, { path: "/about", visitorId: "v-qa-1" });
  await t.mutation(api.siteStats.recordPageview, { path: "/", visitorId: "anon" });
  expect(await visitors(t)).toMatchObject([{ visitorId: "v-qa-1", firstSeenDate: today }]);

  const { code } = await t.mutation(api.game.rooms.hostGame, { visitorId: "v-qa-1" });
  const join = await t.mutation(api.game.rooms.joinGame, {
    code,
    playerId: "qa-p1",
    connectionId: "qa-c1",
    name: "QA-host",
    visitorId: "v-qa-1",
  });
  expect(join.success).toBe(true);
  const [row] = await visitors(t);
  expect(row).toMatchObject({ visitorId: "v-qa-1", firstSeenDate: today, firstPlayedDate: today });

  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const events = await t.run(async (ctx) => ctx.db.query("analyticsEvents").collect());
  const joined = events.find((e) => e.eventType === "player_joined");
  const created = events.find((e) => e.eventType === "game_created");
  expect(joined!.metadata).toEqual({ roomCode: code, playerId: "qa-p1", visitorId: "v-qa-1" });
  expect(created!.metadata).toEqual({ roomCode: code, visitorId: "v-qa-1" });
});

test("old clients without visitorId still host and join", async () => {
  const t = setup();
  const { code } = await t.mutation(api.game.rooms.hostGame, {});
  const join = await t.mutation(api.game.rooms.joinGame, {
    code,
    playerId: "qa-p2",
    connectionId: "qa-c2",
    name: "QA-legacy",
  });
  expect(join.success).toBe(true);
  expect(await visitors(t)).toHaveLength(0);
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const joined = (await t.run(async (ctx) => ctx.db.query("analyticsEvents").collect())).find(
    (e) => e.eventType === "player_joined"
  );
  expect(joined!.metadata).toEqual({ roomCode: code, playerId: "qa-p2" });
});

test("a join with no prior pageview creates the visitor row", async () => {
  const t = setup();
  const { code } = await t.mutation(api.game.rooms.hostGame, {});
  await t.mutation(api.game.rooms.joinGame, {
    code,
    playerId: "qa-p3",
    connectionId: "qa-c3",
    name: "QA-direct",
    visitorId: "v-qa-3",
  });
  const rows = await visitors(t);
  expect(rows).toHaveLength(1);
  expect(rows[0].firstPlayedDate).toBe(rows[0].firstSeenDate);
});

test("backfillVisitorFirstSeen seeds the earliest pageview date", async () => {
  const t = setup();
  await t.run(async (ctx) => {
    await ctx.db.insert("pageviewVisits", { date: "2026-08-10", visitorId: "v-a" });
    await ctx.db.insert("pageviewVisits", { date: "2026-08-02", visitorId: "v-a" });
    await ctx.db.insert("pageviewVisits", { date: "2026-08-05", visitorId: "v-b" });
    await ctx.db.insert("pageviewVisits", { date: "2026-08-05", visitorId: "anon" });
    // Already recorded later than its real first visit.
    await ctx.db.insert("visitorFirstSeen", { visitorId: "v-b", firstSeenDate: "2026-09-01" });
  });
  await t.mutation(internal.siteStats.backfillVisitorFirstSeen, { pageSize: 1 });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  const rows = (await visitors(t)).map((r) => [r.visitorId, r.firstSeenDate]).sort();
  expect(rows).toEqual([
    ["v-a", "2026-08-02"],
    ["v-b", "2026-08-05"],
  ]);
});
