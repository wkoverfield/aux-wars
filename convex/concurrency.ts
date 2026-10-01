import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";

/**
 * Concurrency sampling.
 *
 * A 60s cron (see crons.ts) runs sampleAndRecord, an internal action that:
 *   1. runs sampleNow, a read-only internal query over rooms and players, then
 *   2. runs recordSampleRows, a mutation that reads and writes only
 *      concurrencyStats.
 * Keeping the rooms/players reads out of the writing transaction means the
 * sampler can never conflict with (or be retried because of) gameplay writes.
 *
 * concurrencyStats holds one "latest" row (rewritten every sample), one max
 * row per UTC hour, and one all-time record row. Hour and record rows are
 * written only when a sample beats what they hold. The table is read only by
 * the key-gated stats queries, never by homepage or gameplay subscriptions.
 *
 * "Online" here means seated: a player row in a room with a real game action
 * in the last ACTIVE_ROOM_WINDOW_MS. Connectedness itself lives in the
 * presence component, which can only be listed one room at a time; counting
 * seats instead keeps the sample to plain indexed reads. A player who closes
 * the tab stays seated until cleanupInactivePlayers removes them or the room
 * goes quiet for the window, whichever comes first.
 */

// Only rooms with a game action this recent are counted. A game in progress
// touches lastActivityAt on every phase change, so live games always qualify;
// a room everyone walked away from drops out once it has been quiet this long.
export const ACTIVE_ROOM_WINDOW_MS = 15 * 60 * 1000;
// Hard cap on rooms read per sample. Rooms are read newest-activity first, so
// hitting the cap drops the longest-idle rooms in the window, never the live ones.
export const MAX_ROOMS_SCANNED = 200;
// Above the pro player cap (50), so a full room is never truncated. With the
// room cap this bounds a sample to 200 + 200 * 64 document reads.
const PLAYERS_PER_ROOM_LIMIT = 64;

const HOUR_MS = 60 * 60 * 1000;

export type ConcurrencySample = {
  playersOnline: number;
  playersInGame: number;
  activeRooms: number;
  activeGames: number;
};

const SAMPLE_KEYS = ["playersOnline", "playersInGame", "activeRooms", "activeGames"] as const;

const NOT_IN_GAME_PHASES = new Set<Doc<"rooms">["phase"]>(["lobby", "gameOver"]);

export function isInGamePhase(phase: Doc<"rooms">["phase"]): boolean {
  return !NOT_IN_GAME_PHASES.has(phase);
}

/**
 * Counts the current moment from rooms and players only (bounded, no
 * component calls).
 * playersOnline: players seated in any recently active room.
 * playersInGame: those seated in a room past the lobby and not over.
 * activeRooms: recently active rooms with at least one seated player.
 * activeGames: active rooms whose phase is in game.
 */
export async function sampleConcurrency(ctx: QueryCtx, now: number): Promise<ConcurrencySample> {
  const cutoff = now - ACTIVE_ROOM_WINDOW_MS;
  const rooms = await ctx.db
    .query("rooms")
    .withIndex("by_lastActivityAt", (q) => q.gte("lastActivityAt", cutoff))
    .order("desc")
    .take(MAX_ROOMS_SCANNED);
  const sample: ConcurrencySample = {
    playersOnline: 0,
    playersInGame: 0,
    activeRooms: 0,
    activeGames: 0,
  };
  for (const room of rooms) {
    const seated = await ctx.db
      .query("players")
      .withIndex("by_room", (q) => q.eq("roomCode", room.code))
      .take(PLAYERS_PER_ROOM_LIMIT);
    if (seated.length === 0) continue;
    sample.playersOnline += seated.length;
    sample.activeRooms += 1;
    if (isInGamePhase(room.phase)) {
      sample.playersInGame += seated.length;
      sample.activeGames += 1;
    }
  }
  return sample;
}

type Maxes = ConcurrencySample;

/**
 * Element-wise max of a stored row and a new sample. Returns null when the
 * sample beats nothing (the caller then skips the write).
 */
export function mergeMax(existing: Maxes | null, sample: ConcurrencySample): Maxes | null {
  if (!existing) {
    const anyNonZero = SAMPLE_KEYS.some((k) => sample[k] > 0);
    return anyNonZero ? { ...sample } : null;
  }
  let changed = false;
  const next = { ...existing };
  for (const k of SAMPLE_KEYS) {
    if (sample[k] > existing[k]) {
      next[k] = sample[k];
      changed = true;
    }
  }
  return changed ? next : null;
}

export function hourStartOf(ms: number): number {
  return Math.floor(ms / HOUR_MS) * HOUR_MS;
}

function pickMaxes(row: Doc<"concurrencyStats">): Maxes {
  return {
    playersOnline: row.playersOnline,
    playersInGame: row.playersInGame,
    activeRooms: row.activeRooms,
    activeGames: row.activeGames,
  };
}

/**
 * Folds one sample into concurrencyStats: always refreshes the latest row;
 * writes the hour and all-time rows only when the sample beats them.
 * Exported for tests.
 */
export async function recordSample(
  ctx: MutationCtx,
  sample: ConcurrencySample,
  now: number
): Promise<{ hour: "inserted" | "patched" | "unchanged"; allTime: "inserted" | "patched" | "unchanged" }> {
  const hourStart = hourStartOf(now);
  const iso = new Date(hourStart).toISOString();

  const hourRow = await ctx.db
    .query("concurrencyStats")
    .withIndex("by_kind_and_hourStart", (q) => q.eq("kind", "hour").eq("hourStart", hourStart))
    .unique();
  const hourNext = mergeMax(hourRow ? pickMaxes(hourRow) : null, sample);
  let hour: "inserted" | "patched" | "unchanged" = "unchanged";
  if (hourNext && hourRow) {
    await ctx.db.patch(hourRow._id, { ...hourNext, updatedAt: now });
    hour = "patched";
  } else if (hourNext) {
    await ctx.db.insert("concurrencyStats", {
      kind: "hour",
      hourStart,
      date: iso.slice(0, 10),
      hourUTC: new Date(hourStart).getUTCHours(),
      ...hourNext,
      updatedAt: now,
    });
    hour = "inserted";
  }

  const recordRow = await readAllTimeRow(ctx);
  const recordNext = mergeMax(recordRow ? pickMaxes(recordRow) : null, sample);
  let allTime: "inserted" | "patched" | "unchanged" = "unchanged";
  if (recordNext && recordRow) {
    await ctx.db.patch(recordRow._id, {
      ...recordNext,
      playersOnlineAt:
        sample.playersOnline > recordRow.playersOnline ? now : recordRow.playersOnlineAt,
      playersInGameAt:
        sample.playersInGame > recordRow.playersInGame ? now : recordRow.playersInGameAt,
      updatedAt: now,
    });
    allTime = "patched";
  } else if (recordNext) {
    await ctx.db.insert("concurrencyStats", {
      kind: "allTime",
      hourStart: 0,
      ...recordNext,
      playersOnlineAt: sample.playersOnline > 0 ? now : undefined,
      playersInGameAt: sample.playersInGame > 0 ? now : undefined,
      updatedAt: now,
    });
    allTime = "inserted";
  }

  const latestRow = await readLatestRow(ctx);
  const latest = { ...sample, updatedAt: now };
  if (latestRow) {
    await ctx.db.patch(latestRow._id, latest);
  } else {
    await ctx.db.insert("concurrencyStats", { kind: "latest", hourStart: 0, ...latest });
  }

  return { hour, allTime };
}

/** The most recent sample (updatedAt is when it was taken), or null. */
export async function readLatestRow(ctx: QueryCtx) {
  return await ctx.db
    .query("concurrencyStats")
    .withIndex("by_kind_and_hourStart", (q) => q.eq("kind", "latest").eq("hourStart", 0))
    .unique();
}

/** The all-time record row, or null before the first non-zero sample. */
export async function readAllTimeRow(ctx: QueryCtx) {
  return await ctx.db
    .query("concurrencyStats")
    .withIndex("by_kind_and_hourStart", (q) => q.eq("kind", "allTime").eq("hourStart", 0))
    .unique();
}

const sampleValidator = v.object({
  playersOnline: v.number(),
  playersInGame: v.number(),
  activeRooms: v.number(),
  activeGames: v.number(),
});

/** Read-only: the current sample from rooms and players. */
export const sampleNow = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, { now }) => await sampleConcurrency(ctx, now),
});

/** Writes one sample. Touches only concurrencyStats. */
export const recordSampleRows = internalMutation({
  args: { sample: sampleValidator, sampledAt: v.number() },
  handler: async (ctx, { sample, sampledAt }) => await recordSample(ctx, sample, sampledAt),
});

type SampleResult = ConcurrencySample & {
  hour: "inserted" | "patched" | "unchanged";
  allTime: "inserted" | "patched" | "unchanged";
};

/** Cron entry point: sample now (query), then fold it into concurrencyStats (mutation). */
export const sampleAndRecord = internalAction({
  args: {},
  handler: async (ctx): Promise<SampleResult> => {
    const now = Date.now();
    const sample: ConcurrencySample = await ctx.runQuery(internal.concurrency.sampleNow, { now });
    const result = await ctx.runMutation(internal.concurrency.recordSampleRows, {
      sample,
      sampledAt: now,
    });
    return { ...sample, ...result };
  },
});
