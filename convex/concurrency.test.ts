import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import schema from "./schema";
import { internal } from "./_generated/api";
import presenceComponent from "@convex-dev/presence/test";
import {
  ACTIVE_ROOM_WINDOW_MS,
  MAX_ROOMS_SCANNED,
  hourStartOf,
  mergeMax,
  recordSample,
  type ConcurrencySample,
} from "./concurrency";
import type { Doc } from "./_generated/dataModel";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./**/*.d.ts"]);
const HOUR = 60 * 60 * 1000;

function setup() {
  const t = convexTest(schema, modules);
  presenceComponent.register(t, "presence");
  return t;
}

const s = (playersOnline: number, playersInGame: number, activeRooms: number, activeGames: number): ConcurrencySample => ({
  playersOnline,
  playersInGame,
  activeRooms,
  activeGames,
});

describe("mergeMax", () => {
  test("no row and an all-zero sample writes nothing", () => {
    expect(mergeMax(null, s(0, 0, 0, 0))).toBeNull();
  });
  test("no row and a non-zero sample becomes the row", () => {
    expect(mergeMax(null, s(3, 0, 1, 0))).toEqual(s(3, 0, 1, 0));
  });
  test("a sample that beats nothing writes nothing", () => {
    expect(mergeMax(s(5, 4, 2, 1), s(5, 3, 2, 0))).toBeNull();
  });
  test("each field keeps its own max", () => {
    expect(mergeMax(s(5, 4, 2, 1), s(3, 6, 1, 2))).toEqual(s(5, 6, 2, 2));
  });
});

async function allRows(t: ReturnType<typeof setup>) {
  return await t.run(async (ctx) => ctx.db.query("concurrencyStats").collect());
}

describe("recordSample", () => {
  test("writes an hour row and the record only when beaten", async () => {
    const t = setup();
    const t0 = hourStartOf(Date.UTC(2026, 8, 1, 14, 5));

    let r = await t.run((ctx) => recordSample(ctx, s(0, 0, 0, 0), t0));
    expect(r).toEqual({ hour: "unchanged", allTime: "unchanged" });
    // Only the latest-sample row exists after an all-zero sample.
    expect((await allRows(t)).map((x) => x.kind)).toEqual(["latest"]);

    r = await t.run((ctx) => recordSample(ctx, s(4, 2, 2, 1), t0 + 60_000));
    expect(r).toEqual({ hour: "inserted", allTime: "inserted" });

    // Same numbers again: nothing written.
    r = await t.run((ctx) => recordSample(ctx, s(4, 2, 2, 1), t0 + 120_000));
    expect(r).toEqual({ hour: "unchanged", allTime: "unchanged" });

    // New in-game high only: both rows patched, online record time kept.
    r = await t.run((ctx) => recordSample(ctx, s(3, 3, 1, 1), t0 + 180_000));
    expect(r).toEqual({ hour: "patched", allTime: "patched" });

    const rows = await allRows(t);
    expect(rows.filter((x) => x.kind === "latest")).toHaveLength(1);
    expect(rows.find((x) => x.kind === "latest")).toMatchObject({ playersOnline: 3, playersInGame: 3, updatedAt: t0 + 180_000 });
    const hour = rows.find((x) => x.kind === "hour") as Doc<"concurrencyStats">;
    const record = rows.find((x) => x.kind === "allTime") as Doc<"concurrencyStats">;
    expect(hour).toMatchObject({ date: "2026-09-01", hourUTC: 14, playersOnline: 4, playersInGame: 3 });
    expect(record).toMatchObject({
      playersOnline: 4,
      playersInGame: 3,
      playersOnlineAt: t0 + 60_000,
      playersInGameAt: t0 + 180_000,
    });
  });

  test("a new hour gets its own row; a lower sample leaves the record alone", async () => {
    const t = setup();
    const t0 = hourStartOf(Date.UTC(2026, 8, 1, 20, 0));
    await t.run((ctx) => recordSample(ctx, s(10, 8, 3, 2), t0));
    const r = await t.run((ctx) => recordSample(ctx, s(2, 0, 1, 0), t0 + HOUR));
    expect(r).toEqual({ hour: "inserted", allTime: "unchanged" });
    const hours = (await allRows(t)).filter((x) => x.kind === "hour");
    expect(hours.map((h) => [h.hourUTC, h.playersOnline])).toEqual([
      [20, 10],
      [21, 2],
    ]);
  });
});

async function insertRoom(
  t: ReturnType<typeof setup>,
  code: string,
  phase: Doc<"rooms">["phase"],
  lastActivityAt: number
) {
  await t.run(async (ctx) => {
    await ctx.db.insert("rooms", {
      code,
      phase,
      currentRound: 1,
      settings: { numberOfRounds: 3, roundLength: 60, snippetDuration: 30, selectedPrompts: ["a"] },
      createdAt: lastActivityAt,
      lastActivityAt,
    });
  });
}

async function seat(t: ReturnType<typeof setup>, code: string, playerId: string) {
  await t.run(async (ctx) => {
    await ctx.db.insert("players", {
      roomCode: code,
      playerId,
      name: `QA-${playerId}`,
      isHost: false,
      isReady: false,
    });
  });
}

test("sampleAndRecord counts seated players by room phase", async () => {
  const t = setup();
  const now = Date.now();
  await insertRoom(t, "QALOBY", "lobby", now);
  await insertRoom(t, "QAGAME", "rating", now);
  await insertRoom(t, "QAOVER", "gameOver", now);
  await insertRoom(t, "QAOLD1", "rating", now - ACTIVE_ROOM_WINDOW_MS - HOUR);
  await seat(t, "QALOBY", "a");
  await seat(t, "QAGAME", "b");
  await seat(t, "QAGAME", "c");
  await seat(t, "QAOVER", "d");
  await seat(t, "QAOLD1", "e"); // quiet longer than the window: not counted
  await insertRoom(t, "QAEMPT", "rating", now); // no seated players: not an active room

  const result = await t.action(internal.concurrency.sampleAndRecord, {});
  expect(result).toMatchObject({
    playersOnline: 4,
    playersInGame: 2,
    activeRooms: 3,
    activeGames: 1,
    hour: "inserted",
    allTime: "inserted",
  });

  // Same moment again: the record is not rewritten.
  const again = await t.action(internal.concurrency.sampleAndRecord, {});
  expect(again).toMatchObject({ hour: "unchanged", allTime: "unchanged" });
  const latest = (await allRows(t)).filter((x) => x.kind === "latest");
  expect(latest).toHaveLength(1);
  expect(latest[0]).toMatchObject({ playersOnline: 4, playersInGame: 2, activeRooms: 3, activeGames: 1 });
});

test("sampleAndRecord finds live rooms past the scan cap", async () => {
  const t = setup();
  const now = Date.now();
  const settings = { numberOfRounds: 3, roundLength: 60, snippetDuration: 30, selectedPrompts: ["a"] };
  // Oldest by creation: more stale rooms than the cap, all outside the window.
  // Then more in-window rooms than the cap, the most recently active last.
  const stale = MAX_ROOMS_SCANNED + 20;
  const inWindow = MAX_ROOMS_SCANNED + 10;
  await t.run(async (ctx) => {
    for (let i = 0; i < stale; i++) {
      const at = now - ACTIVE_ROOM_WINDOW_MS - HOUR - i * 1000;
      await ctx.db.insert("rooms", {
        code: `QS${i}`,
        phase: "lobby",
        currentRound: 1,
        settings,
        createdAt: at,
        lastActivityAt: at,
      });
    }
    for (let i = 0; i < inWindow; i++) {
      const at = now - ACTIVE_ROOM_WINDOW_MS + 60_000 + i * 1000;
      await ctx.db.insert("rooms", {
        code: `QW${i}`,
        phase: "lobby",
        currentRound: 1,
        settings,
        createdAt: at,
        lastActivityAt: at,
      });
    }
  });
  await insertRoom(t, "QALIVE", "rating", now);
  await seat(t, "QALIVE", "a");
  await seat(t, "QALIVE", "b");
  await seat(t, "QW0", "c"); // least recently active in-window room: past the cap

  const result = await t.action(internal.concurrency.sampleAndRecord, {});
  expect(result).toMatchObject({
    playersOnline: 2,
    playersInGame: 2,
    activeRooms: 1,
    activeGames: 1,
  });
});
