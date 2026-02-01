import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

/**
 * Internal mutation for tracking analytics events.
 * Use ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {...}) for fire-and-forget tracking.
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
    await ctx.db.insert("analyticsEvents", {
      eventType,
      timestamp: Date.now(),
      metadata,
    });
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
