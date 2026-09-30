import { internalMutation, internalQuery } from "./_generated/server";
import { readCounter as readShardedCounter } from "./siteStats";

const dstr = (ms: number) => new Date(ms).toISOString().slice(0, 10); // YYYY-MM-DD (UTC)

/**
 * Bank a permanent daily snapshot of the all-time cumulative counters.
 *
 * Reads every analyticsAggregates action count (game_completed, game_started,
 * game_abandoned, prompt_pack_used:*, and any future event type) plus the
 * permanent pageview counters (all-time total and today's views/uniques), and
 * upserts a single row for today's UTC date. The underlying counters never
 * prune, but they are cumulative-only; snapshotting them once a day lets any
 * time window (7d/30d/yearly) be derived by diffing two dates, forever —
 * immune to the 90-day raw-event pruning.
 *
 * Idempotent: re-running the same UTC day patches the existing row instead of
 * inserting a duplicate. Writes only its own table — never touches game docs,
 * so it can't trigger rooms/players query invalidation.
 */
export const snapshotDailyMetrics = internalMutation({
  args: {},
  handler: async (ctx) => {
    const date = dstr(Date.now());

    // All-time cumulative action counters (never pruned).
    const aggregates = await ctx.db.query("analyticsAggregates").collect();
    const metrics: Record<string, number> = {};
    for (const a of aggregates) {
      metrics[`agg:${a.eventType}`] = a.count;
    }

    // Permanent pageview counters: all-time total plus today's views/uniques.
    const readCounter = (key: string) => readShardedCounter(ctx, key);
    metrics["pageviews:total"] = await readCounter("total");
    metrics["pageviews:day"] = await readCounter(`day:${date}`);
    metrics["pageviews:uvday"] = await readCounter(`uvday:${date}`);

    const capturedAt = Date.now();

    // Idempotent upsert: exactly one row per UTC date.
    const existing = await ctx.db
      .query("metricSnapshots")
      .withIndex("by_date", (q) => q.eq("date", date))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { capturedAt, metrics });
    } else {
      await ctx.db.insert("metricSnapshots", { date, capturedAt, metrics });
    }

    return {
      date,
      metricCount: Object.keys(metrics).length,
      action: existing ? "patched" : "inserted",
    };
  },
});

/**
 * Full snapshot series in chronological order (oldest first), for the digest
 * reader. Diff consecutive rows to derive per-window deltas for any counter.
 */
export const getMetricSnapshots = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("metricSnapshots")
      .withIndex("by_date")
      .collect();
    return rows.map((r) => ({
      date: r.date,
      capturedAt: r.capturedAt,
      metrics: r.metrics,
    }));
  },
});
