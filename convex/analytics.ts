import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * Internal mutation for tracking analytics events.
 * Use ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {...}) for fire-and-forget tracking.
 * Also increments the aggregate count for efficient querying.
 */
const eventMetadata = v.optional(v.object({
  roomCode: v.optional(v.string()),
  playerId: v.optional(v.string()),
  playerCount: v.optional(v.number()),
  roundNumber: v.optional(v.number()),
  totalRounds: v.optional(v.number()),
  value: v.optional(v.number()),
  label: v.optional(v.string()),
  phase: v.optional(v.string()),
  visitorId: v.optional(v.string()), // opaque client visitor id (retention linkage)
  reason: v.optional(v.string()), // search_failed: see searchFailReason
}));

const DAY_MS = 24 * 60 * 60 * 1000;

const SEARCH_FAIL_REASON_RE = /^(timeout|network|bad_payload|http_\d{3})$/;

/**
 * Failure class of a client music search: "timeout", "network",
 * "bad_payload" or "http_<status>". Anything else reads "unknown".
 */
export function searchFailReason(reason: unknown): string {
  return typeof reason === "string" && SEARCH_FAIL_REASON_RE.test(reason) ? reason : "unknown";
}

const PUBLIC_EVENT_TYPES = new Set([
  "pro_cta_viewed",
  "pro_checkout_started",
  "search_failed",
  "search_no_results",
  "session_start",
  "vote_listen",
]);

export const trackEvent = internalMutation({
  args: {
    eventType: v.string(),
    metadata: eventMetadata,
  },
  handler: async (ctx, { eventType, metadata }) => {
    if (AGGREGATE_ONLY_EVENT_TYPES.has(eventType)) {
      // High-volume, low-value-per-row events: counted, never stored raw.
      await bumpAggregate(ctx, eventType, 1);
      const ms = metadata?.value;
      if (eventType === "vote_listen" && typeof ms === "number" && Number.isFinite(ms)) {
        await bumpAggregate(ctx, LISTEN_MS_TOTAL, Math.round(Math.min(Math.max(ms, 0), MAX_LISTEN_MS)));
        await bumpAggregate(ctx, LISTEN_MS_SAMPLES, 1);
      }
      return;
    }

    await ctx.db.insert("analyticsEvents", {
      eventType,
      timestamp: Date.now(),
      metadata,
    });
    await bumpAggregate(ctx, eventType, 1);
  },
});

// Event types kept only as an all-time count in analyticsAggregates (plus the
// daily metricSnapshots of that count), with no analyticsEvents row per event.
// vote_listen fires once per rating and made up a third of the raw table.
export const AGGREGATE_ONLY_EVENT_TYPES = new Set(["vote_listen"]);
// Running sum of vote_listen metadata.value (ms) and how many values it holds,
// so average listen time is LISTEN_MS_TOTAL / LISTEN_MS_SAMPLES. Each value is
// clamped because the event comes from a public mutation.
export const LISTEN_MS_TOTAL = "vote_listen:ms_total";
export const LISTEN_MS_SAMPLES = "vote_listen:ms_samples";
const MAX_LISTEN_MS = 10 * 60 * 1000;

async function bumpAggregate(ctx: MutationCtx, eventType: string, by: number) {
  const existing = await ctx.db
    .query("analyticsAggregates")
    .withIndex("by_type", (q) => q.eq("eventType", eventType))
    .first();
  if (existing) {
    await ctx.db.patch(existing._id, { count: existing.count + by, lastUpdated: Date.now() });
  } else {
    await ctx.db.insert("analyticsAggregates", { eventType, count: by, lastUpdated: Date.now() });
  }
}

/**
 * Public, fire-and-forget event logger for client-side analytics
 * (pro funnel, search-no-results, listen time, returning device, etc.).
 * Schedules the internal trackEvent so the client never touches internals.
 */
export const logEvent = mutation({
  args: {
    eventType: v.string(),
    metadata: eventMetadata,
  },
  handler: async (ctx, { eventType, metadata }) => {
    if (!PUBLIC_EVENT_TYPES.has(eventType)) {
      return { success: false, message: "Unsupported event type" } as const;
    }
    if (eventType === "search_failed") {
      // Only the failure class is kept: never query text or other fields.
      metadata = { reason: searchFailReason(metadata?.reason) };
    }
    await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, { eventType, metadata });
    return { success: true } as const;
  },
});

/**
 * Get total count of completed games
 */
export const getTotalGamesCompleted = internalQuery({
  args: {},
  handler: async (ctx) => {
    const events = await ctx.db
      .query("analyticsEvents")
      .withIndex("by_type", (q) => q.eq("eventType", "game_completed"))
      .collect();
    return events.length;
  },
});

/**
 * Get games per day for the last N days
 */
export const getGamesPerDay = internalQuery({
  args: { days: v.number() },
  handler: async (ctx, { days }) => {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const events = await ctx.db
      .query("analyticsEvents")
      .withIndex("by_type_and_timestamp", (q) =>
        q.eq("eventType", "game_completed").gte("timestamp", cutoff)
      )
      .collect();

    const counts: Record<string, number> = {};
    for (const event of events) {
      const date = new Date(event.timestamp).toISOString().split("T")[0];
      counts[date] = (counts[date] || 0) + 1;
    }
    return counts;
  },
});

/**
 * Get average players per completed game
 */
export const getAveragePlayersPerGame = internalQuery({
  args: {},
  handler: async (ctx) => {
    const events = await ctx.db
      .query("analyticsEvents")
      .withIndex("by_type", (q) => q.eq("eventType", "game_completed"))
      .collect();

    if (events.length === 0) return 0;

    const totalPlayers = events.reduce((sum, event) => {
      return sum + (event.metadata?.playerCount || 0);
    }, 0);

    return totalPlayers / events.length;
  },
});

/**
 * Get event counts by type
 */
export const getEventCounts = internalQuery({
  args: {},
  handler: async (ctx) => {
    const allEvents = await ctx.db.query("analyticsEvents").collect();
    const counts: Record<string, number> = {};
    for (const event of allEvents) {
      counts[event.eventType] = (counts[event.eventType] || 0) + 1;
    }
    return counts;
  },
});

/**
 * Get count for a specific event type (uses index, avoids document limit)
 */
export const getCountByEventType = internalQuery({
  args: { eventType: v.string() },
  handler: async (ctx, { eventType }) => {
    const events = await ctx.db
      .query("analyticsEvents")
      .withIndex("by_type", (q) => q.eq("eventType", eventType))
      .collect();
    return events.length;
  },
});

const CLEANUP_BATCH = 1000;
const MAX_GUARD_DAYS = 400;

/**
 * Upper bound for deleting raw events: the start of the oldest UTC date that
 * has no dailyMetrics row, capped at the retention cutoff. A day's raw events
 * are the only source for its permanent rollup, so they are never deleted
 * before that rollup exists. With no rollups at all nothing is deleted.
 */
async function rolledUpBefore(ctx: MutationCtx, cutoff: number): Promise<number> {
  const oldest = await ctx.db.query("analyticsEvents").withIndex("by_timestamp").order("asc").first();
  if (!oldest || oldest.timestamp >= cutoff) return cutoff;
  let dayStart = Math.floor(oldest.timestamp / DAY_MS) * DAY_MS;
  for (let i = 0; i < MAX_GUARD_DAYS && dayStart < cutoff; i++) {
    const date = new Date(dayStart).toISOString().slice(0, 10);
    const row = await ctx.db
      .query("dailyMetrics")
      .withIndex("by_date", (q) => q.eq("date", date))
      .first();
    if (!row) return dayStart;
    dayStart += DAY_MS;
  }
  return Math.min(dayStart, cutoff);
}

/**
 * Deletes raw analyticsEvents older than the retention window, in batches.
 * Each run deletes up to batchSize rows and reschedules itself until nothing
 * deletable is left, so a large backlog drains over many small transactions.
 * Never deletes a day that has not been rolled up (see rolledUpBefore).
 */
export const cleanupOldEvents = internalMutation({
  args: {
    retentionDays: v.number(),
    batchSize: v.optional(v.number()),
    before: v.optional(v.number()), // bound fixed by the first batch of a drain
  },
  handler: async (ctx, { retentionDays, batchSize, before }) => {
    const n = Math.min(Math.max(batchSize ?? CLEANUP_BATCH, 1), 4000);
    const bound =
      before ?? (await rolledUpBefore(ctx, Date.now() - retentionDays * DAY_MS));
    const batch = await ctx.db
      .query("analyticsEvents")
      .withIndex("by_timestamp", (q) => q.lt("timestamp", bound))
      .take(n);
    for (const event of batch) {
      await ctx.db.delete(event._id);
    }
    const more = batch.length === n;
    if (more) {
      await ctx.scheduler.runAfter(0, internal.analytics.cleanupOldEvents, {
        retentionDays,
        batchSize: n,
        before: bound,
      });
    }
    if (batch.length > 0) {
      console.log(
        `[analytics] Deleted ${batch.length} events before ${new Date(bound).toISOString()}${more ? " (continuing)" : ""}`
      );
    }
    return { deleted: batch.length, before: bound, more };
  },
});

/**
 * Get all aggregate counts (efficient - reads only aggregate table, not all events)
 */
export const getAllAggregates = query({
  args: {},
  handler: async (ctx) => {
    const aggregates = await ctx.db.query("analyticsAggregates").collect();
    const result: Record<string, number> = {};
    for (const agg of aggregates) {
      result[agg.eventType] = agg.count;
    }
    return result;
  },
});

/**
 * Rewrite the homepage counters from analyticsAggregates. Runs on a cron once
 * a minute; writes only when a number changed, so subscribers re-run at most
 * once a minute and never on a quiet minute.
 */
export const refreshLiveStats = internalMutation({
  args: {},
  handler: async (ctx) => {
    const count = async (eventType: string) => {
      const row = await ctx.db
        .query("analyticsAggregates")
        .withIndex("by_type", (q) => q.eq("eventType", eventType))
        .first();
      return row?.count ?? 0;
    };
    const next = {
      gameStarted: await count("game_started"),
      playerJoined: await count("player_joined"),
      ratingSubmitted: await count("rating_submitted"),
    };
    const existing = await ctx.db.query("liveStats").first();
    if (
      existing &&
      existing.gameStarted === next.gameStarted &&
      existing.playerJoined === next.playerJoined &&
      existing.ratingSubmitted === next.ratingSubmitted
    ) {
      return { action: "unchanged" };
    }
    if (existing) {
      await ctx.db.patch(existing._id, { ...next, updatedAt: Date.now() });
      return { action: "patched" };
    }
    await ctx.db.insert("liveStats", { ...next, updatedAt: Date.now() });
    return { action: "inserted" };
  },
});

/**
 * Homepage counters. Reads the single liveStats row (see refreshLiveStats);
 * null until the first refresh has run.
 */
export const getLiveStats = query({
  args: {},
  handler: async (ctx) => {
    const row = await ctx.db.query("liveStats").first();
    if (!row) return null;
    return {
      game_started: row.gameStarted,
      player_joined: row.playerJoined,
      rating_submitted: row.ratingSubmitted,
    };
  },
});

// Bounds how many recent events the analysis queries below scan (keeps reads safe
// for high-volume events like vote_listen; a recent sample is plenty for stats).
const STATS_SAMPLE_CAP = 10000;

/**
 * Median/avg time (seconds) players listen before voting. Percentiles come
 * from legacy raw vote_listen rows while any remain; the all-time average
 * comes from the running aggregates. — answers "how long do
 * people actually listen?" and sets the right rating clip length.
 */
export const getListenTimeStats = internalQuery({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, { days = 30 }) => {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const events = await ctx.db
      .query("analyticsEvents")
      .withIndex("by_type_and_timestamp", (q) =>
        q.eq("eventType", "vote_listen").gte("timestamp", cutoff)
      )
      .order("desc")
      .take(STATS_SAMPLE_CAP);
    const values = events
      .map((e) => e.metadata?.value)
      .filter((v): v is number => typeof v === "number")
      .sort((a, b) => a - b);
    // Running average from the aggregates (new events are not stored raw).
    const agg = async (t: string) =>
      (await ctx.db.query("analyticsAggregates").withIndex("by_type", (q) => q.eq("eventType", t)).first())
        ?.count ?? 0;
    const msTotal = await agg(LISTEN_MS_TOTAL);
    const msSamples = await agg(LISTEN_MS_SAMPLES);
    const allTime = {
      allTimeSamples: msSamples,
      allTimeAvgSec: msSamples > 0 ? Math.round(msTotal / msSamples / 100) / 10 : null,
    };
    if (values.length === 0) return { count: 0, sampledLastNDays: days, ...allTime };
    const sum = values.reduce((a, b) => a + b, 0);
    const pct = (p: number) => values[Math.min(values.length - 1, Math.floor(p * values.length))];
    const toSec = (ms: number) => Math.round(ms / 100) / 10; // ms -> seconds, 1 decimal
    return {
      count: values.length,
      avgSec: toSec(sum / values.length),
      medianSec: toSec(pct(0.5)),
      p25Sec: toSec(pct(0.25)),
      p75Sec: toSec(pct(0.75)),
      maxSec: toSec(values[values.length - 1]),
      sampledLastNDays: days,
      ...allTime,
    };
  },
});

/**
 * Searches our iTunes/Deezer sources couldn't fill, most frequent first.
 * The catalog-gap finder (the churn worry made measurable).
 */
export const getTopMissingSearches = internalQuery({
  args: { days: v.optional(v.number()), limit: v.optional(v.number()) },
  handler: async (ctx, { days = 30, limit = 30 }) => {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const events = await ctx.db
      .query("analyticsEvents")
      .withIndex("by_type_and_timestamp", (q) =>
        q.eq("eventType", "search_no_results").gte("timestamp", cutoff)
      )
      .order("desc")
      .take(STATS_SAMPLE_CAP);
    const counts: Record<string, number> = {};
    for (const e of events) {
      const label = e.metadata?.label;
      if (label) counts[label] = (counts[label] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([query, count]) => ({ query, count }));
  },
});

/**
 * Where unfinished games die, broken down by phase — turns the 53% completion
 * "mystery" into "X% in rating, Y% in songSelection, ..." so you know if there's
 * a real, fixable bottleneck vs. benign drop-off.
 */
export const getAbandonmentByPhase = internalQuery({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, { days = 30 }) => {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const events = await ctx.db
      .query("analyticsEvents")
      .withIndex("by_type_and_timestamp", (q) =>
        q.eq("eventType", "game_abandoned").gte("timestamp", cutoff)
      )
      .order("desc")
      .take(STATS_SAMPLE_CAP);
    const byPhase: Record<string, number> = {};
    for (const e of events) {
      const phase = e.metadata?.phase || "unknown";
      byPhase[phase] = (byPhase[phase] || 0) + 1;
    }
    return { total: events.length, byPhase, sampledLastNDays: days };
  },
});

/**
 * Get a single aggregate count by event type
 */
export const getAggregateCount = internalQuery({
  args: { eventType: v.string() },
  handler: async (ctx, { eventType }) => {
    const agg = await ctx.db
      .query("analyticsAggregates")
      .withIndex("by_type", (q) => q.eq("eventType", eventType))
      .first();
    return agg?.count ?? 0;
  },
});

/**
 * Backfill aggregate counts from existing events (run once after deployment)
 * Processes in batches to avoid timeout. Call repeatedly until it returns done: true.
 */
export const backfillAggregates = internalMutation({
  args: { eventType: v.string(), batchSize: v.optional(v.number()) },
  handler: async (ctx, { eventType, batchSize = 5000 }) => {
    // Count events of this type (up to batch size)
    const events = await ctx.db
      .query("analyticsEvents")
      .withIndex("by_type", (q) => q.eq("eventType", eventType))
      .take(batchSize);

    const count = events.length;

    // Get or create aggregate
    const existing = await ctx.db
      .query("analyticsAggregates")
      .withIndex("by_type", (q) => q.eq("eventType", eventType))
      .first();

    if (existing) {
      // For backfill, we need to count ALL events, not just batch
      // This is a one-time operation, so we'll use a different approach
      await ctx.db.patch(existing._id, {
        count: existing.count, // Keep existing - backfill should set initial value
        lastUpdated: Date.now(),
      });
    } else if (count > 0) {
      await ctx.db.insert("analyticsAggregates", {
        eventType,
        count,
        lastUpdated: Date.now(),
      });
    }

    return { eventType, count, done: count < batchSize };
  },
});

/**
 * Set aggregate count directly (for manual correction or initial backfill)
 */
export const setAggregateCount = internalMutation({
  args: { eventType: v.string(), count: v.number() },
  handler: async (ctx, { eventType, count }) => {
    const existing = await ctx.db
      .query("analyticsAggregates")
      .withIndex("by_type", (q) => q.eq("eventType", eventType))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        count,
        lastUpdated: Date.now(),
      });
    } else {
      await ctx.db.insert("analyticsAggregates", {
        eventType,
        count,
        lastUpdated: Date.now(),
      });
    }

    return { eventType, count };
  },
});

/**
 * Records which prompt packs were used when a game starts (host calls this once
 * per game). Each pack becomes its own event type ("prompt_pack_used:<id>") so
 * per-pack usage shows up directly in getAllAggregates — used later to decide
 * which themes are popular enough to offer as premium packs.
 */
export const logPromptPacksUsed = mutation({
  args: { packIds: v.array(v.string()) },
  handler: async (ctx, { packIds }) => {
    const seen = new Set<string>();
    for (const raw of packIds) {
      const packId = String(raw).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
      if (!packId || seen.has(packId)) continue;
      seen.add(packId);
      await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
        eventType: `prompt_pack_used:${packId}`,
      });
    }
    return { tracked: Array.from(seen) };
  },
});
