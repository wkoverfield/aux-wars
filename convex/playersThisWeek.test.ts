import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import presenceComponent from "@convex-dev/presence/test";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./**/*.d.ts"]);
const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test("players this week counts distinct joiners from the last 7 days", async () => {
  const t = convexTest(schema, modules);
  presenceComponent.register(t, "presence");
  const now = Date.now();
  await t.run(async (ctx) => {
    const join = (timestamp: number, metadata: Record<string, string>) =>
      ctx.db.insert("analyticsEvents", { eventType: "player_joined", timestamp, metadata });
    await join(now - 1 * DAY, { roomCode: "AAAA", playerId: "p1", visitorId: "v1" });
    await join(now - 2 * DAY, { roomCode: "BBBB", playerId: "p1b", visitorId: "v1" }); // same person, new tab
    await join(now - 3 * DAY, { roomCode: "BBBB", playerId: "p2", visitorId: "v2" });
    await join(now - 4 * DAY, { roomCode: "CCCC", playerId: "p3" }); // older client, no visitorId
    await join(now - 8 * DAY, { roomCode: "DDDD", playerId: "p4", visitorId: "v4" }); // outside the week
    await ctx.db.insert("analyticsEvents", { eventType: "game_started", timestamp: now, metadata: { roomCode: "AAAA" } });
    await ctx.db.insert("liveStats", { gameStarted: 1, playerJoined: 5, ratingSubmitted: 0, updatedAt: now });
  });

  const res = await t.mutation(internal.analytics.refreshPlayersThisWeek, {});
  expect(res).toMatchObject({ playersThisWeek: 3, action: "patched" });
  expect((await t.query(api.analytics.getLiveStats, {}))?.players_this_week).toBe(3);

  expect(await t.mutation(internal.analytics.refreshPlayersThisWeek, {})).toMatchObject({ action: "unchanged" });
});
