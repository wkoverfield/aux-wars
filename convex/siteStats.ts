import { mutation, query, internalQuery, internalMutation, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const DAY_MS = 24 * 60 * 60 * 1000;
const dstr = (ms: number) => new Date(ms).toISOString().slice(0, 10); // YYYY-MM-DD (UTC)

/**
 * Normalizes a client-supplied visitor id. Returns null for missing ids and
 * for the shared "anon" fallback, which would merge unrelated visitors.
 */
export function cleanVisitorId(raw: string | undefined | null): string | null {
  // Same truncation as the pageviewVisits key, so retention lookups match.
  const id = (raw ?? "").slice(0, 64);
  if (!id.trim() || id === "anon") return null;
  return id;
}

/**
 * Records the first day a visitor was seen. Inserts only when the visitor has
 * no row yet; an existing row is never rewritten here.
 */
export async function recordVisitorSeen(ctx: MutationCtx, visitorId: string, date: string) {
  const existing = await ctx.db
    .query("visitorFirstSeen")
    .withIndex("by_visitor", (q) => q.eq("visitorId", visitorId))
    .unique();
  if (existing) return;
  await ctx.db.insert("visitorFirstSeen", { visitorId, firstSeenDate: date });
}

/**
 * Records the first day a visitor played (joined a room). Writes only when
 * firstPlayedDate is unset, so repeat joins cost one indexed read.
 */
export async function recordVisitorPlayed(ctx: MutationCtx, visitorId: string, date: string) {
  const existing = await ctx.db
    .query("visitorFirstSeen")
    .withIndex("by_visitor", (q) => q.eq("visitorId", visitorId))
    .unique();
  if (!existing) {
    await ctx.db.insert("visitorFirstSeen", {
      visitorId,
      firstSeenDate: date,
      firstPlayedDate: date,
    });
    return;
  }
  if (existing.firstPlayedDate) return;
  await ctx.db.patch(existing._id, { firstPlayedDate: date });
}

function sanitizePath(raw: string): string | null {
  let p = (raw || "").split("?")[0].split("#")[0].trim();
  if (!p.startsWith("/")) return null;
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  // Collapse the ephemeral lobby game-code segment (a new code per game, forever)
  // so top-pages stay meaningful and pageviewCounters doesn't grow unbounded.
  // "/lobby/ABCD" -> "/lobby/:code", "/lobby/ABCD/round" -> "/lobby/:code/round".
  p = p.replace(/^\/lobby\/[^/]+/, "/lobby/:code");
  if (p.length > 120) p = p.slice(0, 120);
  return p;
}

/**
 * Public: record a pageview. Call fire-and-forget from the client.
 * Increments cumulative counters (total / per-path / per-day) and dedupes
 * unique visitors per day.
 */
export const recordPageview = mutation({
  args: { path: v.string(), visitorId: v.string() },
  handler: async (ctx, { path, visitorId }) => {
    const p = sanitizePath(path);
    if (!p) return;
    const vId = (visitorId || "anon").slice(0, 64);
    const date = dstr(Date.now());

    const bump = async (key: string) => {
      const existing = await ctx.db
        .query("pageviewCounters")
        .withIndex("by_key", (q) => q.eq("key", key))
        .first();
      if (existing) await ctx.db.patch(existing._id, { count: existing.count + 1 });
      else await ctx.db.insert("pageviewCounters", { key, count: 1 });
    };

    await bump("total");
    await bump(`path:${p}`);
    await bump(`day:${date}`);

    const seen = await ctx.db
      .query("pageviewVisits")
      .withIndex("by_date_and_visitor", (q) => q.eq("date", date).eq("visitorId", vId))
      .first();
    if (!seen) {
      await ctx.db.insert("pageviewVisits", { date, visitorId: vId });
      await bump(`uvday:${date}`);
      // First visit of the day: the only time the visitor can be new.
      const firstSeenId = cleanVisitorId(visitorId);
      if (firstSeenId) await recordVisitorSeen(ctx, firstSeenId, date);
    }
  },
});

/**
 * Internal, one-off: seeds visitorFirstSeen from the per-day pageviewVisits
 * rows still on hand (about 120 days). Walks pageviewVisits in date order, so
 * the first row met for a visitor is its earliest; a row that already exists
 * is moved earlier only. Reschedules itself page by page until done.
 * Run before dailyMetrics:backfillDailyMetrics so new/returning and retention
 * have history to work with.
 */
export const backfillVisitorFirstSeen = internalMutation({
  args: { cursor: v.optional(v.union(v.string(), v.null())), pageSize: v.optional(v.number()) },
  handler: async (ctx, { cursor, pageSize }) => {
    const numItems = Math.min(Math.max(pageSize ?? 1000, 1), 2000);
    const page = await ctx.db
      .query("pageviewVisits")
      .withIndex("by_date_and_visitor")
      .paginate({ cursor: cursor ?? null, numItems });
    let inserted = 0;
    let movedEarlier = 0;
    for (const visit of page.page) {
      const visitorId = cleanVisitorId(visit.visitorId);
      if (!visitorId) continue;
      const existing = await ctx.db
        .query("visitorFirstSeen")
        .withIndex("by_visitor", (q) => q.eq("visitorId", visitorId))
        .unique();
      if (!existing) {
        await ctx.db.insert("visitorFirstSeen", { visitorId, firstSeenDate: visit.date });
        inserted++;
      } else if (visit.date < existing.firstSeenDate) {
        await ctx.db.patch(existing._id, { firstSeenDate: visit.date });
        movedEarlier++;
      }
    }
    if (!page.isDone) {
      await ctx.scheduler.runAfter(0, internal.siteStats.backfillVisitorFirstSeen, {
        cursor: page.continueCursor,
        pageSize: numItems,
      });
    }
    return { scanned: page.page.length, inserted, movedEarlier, done: page.isDone };
  },
});

/**
 * Internal: one-call dashboard of traffic + actions + feedback.
 * Run via `npx convex run siteStats:getDashboard --prod`.
 */
export const getDashboard = internalQuery({
  args: {},
  handler: async (ctx) => {
    const counters = await ctx.db.query("pageviewCounters").collect();
    const map: Record<string, number> = {};
    for (const c of counters) map[c.key] = c.count;

    const days: { date: string; views: number; uniques: number }[] = [];
    for (const c of counters) {
      if (c.key.startsWith("day:")) {
        const date = c.key.slice(4);
        days.push({ date, views: c.count, uniques: map[`uvday:${date}`] ?? 0 });
      }
    }
    days.sort((a, b) => (a.date < b.date ? 1 : -1)); // newest first

    const now = Date.now();
    const cutoff7 = dstr(now - 7 * DAY_MS);
    const cutoff30 = dstr(now - 30 * DAY_MS);
    const sum = (cutoff: string, field: "views" | "uniques") =>
      days.filter((d) => d.date >= cutoff).reduce((s, d) => s + d[field], 0);

    const topPages = counters
      .filter((c) => c.key.startsWith("path:"))
      .map((c) => ({ path: c.key.slice(5), views: c.count }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 15);

    const aggs = await ctx.db.query("analyticsAggregates").collect();
    const actions: Record<string, number> = {};
    for (const a of aggs) actions[a.eventType] = a.count;

    const feedback = await ctx.db.query("feedback").collect();
    const byStatus: Record<string, number> = {};
    for (const f of feedback) byStatus[f.status] = (byStatus[f.status] ?? 0) + 1;
    const recent = feedback
      .slice()
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 8)
      .map((f) => ({
        title: f.title,
        type: f.type,
        status: f.status,
        upvotes: f.upvotes,
        createdAt: f.createdAt,
      }));

    return {
      pageviews: {
        total: map["total"] ?? 0,
        last7: sum(cutoff7, "views"),
        last30: sum(cutoff30, "views"),
        byDay: days.slice(0, 30),
      },
      uniques: { last7: sum(cutoff7, "uniques"), last30: sum(cutoff30, "uniques") },
      topPages,
      actions,
      feedback: { total: feedback.length, byStatus, recent },
    };
  },
});

/** Internal: prune the per-day unique-visitor dedup rows older than 120 days (cron). */
export const pruneVisits = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = dstr(Date.now() - 120 * DAY_MS);
    const old = await ctx.db
      .query("pageviewVisits")
      .withIndex("by_date_and_visitor", (q) => q.lt("date", cutoff))
      .take(4000);
    let deleted = 0;
    for (const row of old) {
      await ctx.db.delete(row._id);
      deleted++;
    }
    return { deleted, more: old.length === 4000 };
  },
});

/**
 * Public: cumulative impact numbers for external display (wkoverfield.com
 * reads these at build time). Serves only the latest daily metricSnapshots
 * row — one tiny document, no raw events, no per-user data — so the query is
 * safe and cheap regardless of caller volume. Returns null until the first
 * snapshot exists.
 */
export const publicImpact = query({
  args: {},
  handler: async (ctx) => {
    const snap = await ctx.db
      .query("metricSnapshots")
      .withIndex("by_date")
      .order("desc")
      .first();
    if (!snap) return null;
    const m = snap.metrics;
    return {
      asOf: snap.date,
      players: m["agg:player_joined"] ?? 0,
      games: m["agg:game_completed"] ?? 0,
      songs: m["agg:song_submitted"] ?? 0,
    };
  },
});
