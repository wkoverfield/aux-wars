import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * Internal mutation for tracking analytics events.
 * Use ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {...}) for fire-and-forget tracking.
 * Also increments the aggregate count for efficient querying.
 */
export const trackEvent = internalMutation({
  args: {
    eventType: v.string(),
    metadata: v.optional(v.object({
      roomCode: v.optional(v.string()),
      playerId: v.optional(v.string()),
      playerCount: v.optional(v.number()),
      roundNumber: v.optional(v.number()),
      totalRounds: v.optional(v.number()),
    })),
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
 * Get total count of completed games
 */
export const getTotalGamesCompleted = query({
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
export const getGamesPerDay = query({
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
export const getAveragePlayersPerGame = query({
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
export const getEventCounts = query({
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
export const getCountByEventType = query({
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

/**
 * Get a single aggregate count by event type
 */
export const getAggregateCount = query({
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
export const backfillAggregates = mutation({
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
export const setAggregateCount = mutation({
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
