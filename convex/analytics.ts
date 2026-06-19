import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
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
}));

const PUBLIC_EVENT_TYPES = new Set([
  "pro_cta_viewed",
  "pro_checkout_started",
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
    // Insert the event
    await ctx.db.insert("analyticsEvents", {
      eventType,
      timestamp: Date.now(),
      metadata,
    });

    // Increment aggregate count
    const existing = await ctx.db
      .query("analyticsAggregates")
      .withIndex("by_type", (q) => q.eq("eventType", eventType))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        count: existing.count + 1,
        lastUpdated: Date.now(),
      });
    } else {
      await ctx.db.insert("analyticsAggregates", {
        eventType,
        count: 1,
        lastUpdated: Date.now(),
      });
    }
  },
});

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

/**
 * Internal mutation to clean up old analytics events (called by cron)
 */
export const cleanupOldEvents = internalMutation({
  args: { retentionDays: v.number() },
  handler: async (ctx, { retentionDays }) => {
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const oldEvents = await ctx.db
      .query("analyticsEvents")
      .withIndex("by_timestamp", (q) => q.lt("timestamp", cutoff))
      .collect();

    let deleted = 0;
    for (const event of oldEvents) {
      await ctx.db.delete(event._id);
      deleted++;
    }

    if (deleted > 0) {
      console.log(`[analytics] Cleaned up ${deleted} events older than ${retentionDays} days`);
    }
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

// Bounds how many recent events the analysis queries below scan (keeps reads safe
// for high-volume events like vote_listen; a recent sample is plenty for stats).
const STATS_SAMPLE_CAP = 10000;

/**
 * Median/avg time (seconds) players listen before voting — answers "how long do
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
    if (values.length === 0) return { count: 0, sampledLastNDays: days };
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
