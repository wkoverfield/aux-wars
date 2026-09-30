import type { Doc } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, type QueryCtx } from "./_generated/server";
import { presence } from "./presence";

/**
 * Concurrency sampling.
 *
 * A 60s cron (see crons.ts) counts who is on right now and folds the sample
 * into concurrencyStats: one max row per UTC hour plus one all-time record row.
 * A row is written only when the sample beats what it holds, so a quiet or
 * steady minute writes nothing. concurrencyStats is read only by the key-gated
 * stats queries, never by homepage or gameplay subscriptions.
 */

// Rooms whose last real game action is older than this are not probed for
// presence. Every probe is a presence component call, so this bounds the
// per-sample cost to recently used rooms. A game in progress touches
// lastActivityAt every phase, so only long-idle lobbies fall outside it.
export const ACTIVE_ROOM_WINDOW_MS = 2 * 60 * 60 * 1000;
// Hard cap on rooms read per sample.
const MAX_ROOMS_SCANNED = 500;
// Above the pro player cap (50), so a full room is never truncated.
const PRESENCE_LIMIT = 64;

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
 * Counts the current moment from rooms and presence only (bounded).
 * playersOnline: users with an online presence session in any recent room.
 * playersInGame: those online users whose room is past the lobby and not over.
 * activeRooms: rooms with at least one online user.
 * activeGames: active rooms whose phase is in game.
 */
export async function sampleConcurrency(
  ctx: QueryCtx | MutationCtx,
  now: number
): Promise<ConcurrencySample> {
  const cutoff = now - ACTIVE_ROOM_WINDOW_MS;
  const rooms = await ctx.db.query("rooms").take(MAX_ROOMS_SCANNED);
  const sample: ConcurrencySample = {
    playersOnline: 0,
    playersInGame: 0,
    activeRooms: 0,
    activeGames: 0,
  };
  for (const room of rooms) {
    if (room.lastActivityAt < cutoff) continue;
    const online = await presence.listRoom(ctx, room.code, true, PRESENCE_LIMIT);
    if (online.length === 0) continue;
    sample.playersOnline += online.length;
    sample.activeRooms += 1;
    if (isInGamePhase(room.phase)) {
      sample.playersInGame += online.length;
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
 * Folds one sample into the hour row and the all-time row. Writes only the
 * rows the sample beats. Exported for tests.
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

  const recordRow = await ctx.db
    .query("concurrencyStats")
    .withIndex("by_kind_and_hourStart", (q) => q.eq("kind", "allTime").eq("hourStart", 0))
    .unique();
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

  return { hour, allTime };
}

/** Cron entry point: sample now and fold it into concurrencyStats. */
export const sampleAndRecord = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const sample = await sampleConcurrency(ctx, now);
    const result = await recordSample(ctx, sample, now);
    return { ...sample, ...result };
  },
});
