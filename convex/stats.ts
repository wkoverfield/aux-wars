import { v } from "convex/values";
import { query, type QueryCtx } from "./_generated/server";
import { readAllTimeRow, readLatestRow } from "./concurrency";
import {
  COUNT_EVENT_TYPES,
  DETAIL_EVENT_TYPES,
  addDays,
  computeDayMetrics,
  dayStartMs,
  dstr,
  readEventsCapped,
  readHourPeaks,
  readPageviewDay,
  type DayEvents,
} from "./dailyMetrics";

/**
 * Key-gated stats for the private /stats page.
 *
 * Every query here takes adminKey and compares it in constant time against the
 * STATS_ADMIN_KEY deployment env var. getLive and getDashboard throw on a
 * wrong or empty key, or when the env var is unset; checkKey only reports.
 * Reads are bounded: rollup rows, concurrency rows, and today's low-volume raw
 * events (capped). Raw events are never read beyond the current UTC day.
 */

/** Constant-time string equality (no early exit on the first difference). */
export function constantTimeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    const x = i < a.length ? a.charCodeAt(i) : 0;
    const y = i < b.length ? b.charCodeAt(i) : 0;
    diff |= x ^ y;
  }
  return diff === 0;
}

/** True only for a non-empty key matching a non-empty configured key. */
export function isValidAdminKey(provided: unknown, expected: string | undefined): boolean {
  if (typeof expected !== "string" || expected.length === 0) return false;
  if (typeof provided !== "string" || provided.length === 0) return false;
  return constantTimeEqual(provided, expected);
}

function requireAdminKey(adminKey: string) {
  if (!isValidAdminKey(adminKey, process.env.STATS_ADMIN_KEY)) {
    throw new Error("Unauthorized");
  }
}

/** Reports whether a key is valid. Never throws, never returns stats. */
export const checkKey = query({
  args: { adminKey: v.string() },
  handler: async (_ctx, { adminKey }) => {
    try {
      return { ok: isValidAdminKey(adminKey, process.env.STATS_ADMIN_KEY) };
    } catch {
      return { ok: false };
    }
  },
});

/**
 * The latest stored concurrency sample plus the all-time peak. Reads two
 * concurrencyStats rows and never samples rooms itself, so keeping it
 * subscribed costs one re-run per cron sample. Values are null before the
 * sampler has run once.
 */
export const getLive = query({
  args: { adminKey: v.string() },
  handler: async (ctx, { adminKey }) => {
    requireAdminKey(adminKey);
    const latest = await readLatestRow(ctx);
    const record = await readAllTimeRow(ctx);
    return {
      playersOnline: latest?.playersOnline ?? null,
      playersInGame: latest?.playersInGame ?? null,
      activeRooms: latest?.activeRooms ?? null,
      activeGames: latest?.activeGames ?? null,
      sampledAt: latest?.updatedAt ?? null,
      allTimePeak: record
        ? {
            playersOnline: record.playersOnline,
            playersInGame: record.playersInGame,
            // When the online record was set (the headline number).
            at: record.playersOnlineAt ?? record.updatedAt,
            playersInGameAt: record.playersInGameAt ?? null,
          }
        : null,
    };
  },
});

// Caps for today's in-query raw reads. These event types are a handful per
// game; the caps only matter on an extreme day, and `truncated` says so.
const TODAY_EVENT_CAP = 2000;

async function readToday(ctx: QueryCtx, now: number) {
  const date = dstr(now);
  const start = dayStartMs(date);
  let truncated = false;
  const detail = {} as DayEvents["detail"];
  for (const t of DETAIL_EVENT_TYPES) {
    const r = await readEventsCapped(ctx, t, start, TODAY_EVENT_CAP);
    detail[t] = r.events;
    truncated ||= r.truncated;
  }
  const created = await readEventsCapped(ctx, "game_created", start, TODAY_EVENT_CAP);
  const pro = await readEventsCapped(ctx, "pro_purchased", start, TODAY_EVENT_CAP);
  truncated ||= created.truncated || pro.truncated;
  const counts = Object.fromEntries(COUNT_EVENT_TYPES.map((t) => [t, 0])) as DayEvents["counts"];
  counts.game_created = created.events.length;
  counts.pro_purchased = pro.events.length;

  const { pageviews, uniqueVisitors } = await readPageviewDay(ctx, date);
  const hours = await readHourPeaks(ctx, date);
  const row = computeDayMetrics({
    date,
    computedAt: now,
    events: { detail, counts },
    pageviews,
    uniqueVisitors,
    newVisitors: null,
    newVisitorsPlayed: null,
    newPlayers: null,
    hours,
  });
  // Songs and ratings are the highest-volume events; reading them live would
  // re-run this query on every vote. They land in tomorrow's rollup instead.
  return { ...row, songsSubmitted: null, ratingsSubmitted: null, partial: true as const, truncated };
}

type Ratio = { returned: number; cohort: number };

function ratio(points: Ratio[]): { rate: number | null; cohort: number } {
  const cohort = points.reduce((s, p) => s + p.cohort, 0);
  const returned = points.reduce((s, p) => s + p.returned, 0);
  return { rate: cohort > 0 ? Math.round((returned / cohort) * 10000) / 10000 : null, cohort };
}

/** Trends, curves, retention and funnel for the last 7 or 30 days. */
export const getDashboard = query({
  args: { adminKey: v.string(), days: v.number() },
  handler: async (ctx, { adminKey, days }) => {
    requireAdminKey(adminKey);
    const windowDays = days === 30 ? 30 : 7;
    const now = Date.now();
    const today = dstr(now);
    const windowStart = addDays(today, -windowDays);
    // Retention needs mature cohorts: for dN, cohorts from the window shifted
    // back N days. Read far enough back for d30 (at most 60 small rows).
    const readFrom = addDays(windowStart, -30);

    const allRows = await ctx.db
      .query("dailyMetrics")
      .withIndex("by_date", (q) => q.gte("date", readFrom).lt("date", today))
      .take(windowDays + 31);
    const rows = allRows.filter((r) => r.date >= windowStart);
    const daysOut = rows.map(({ _id, _creationTime, ...rest }) => rest);

    // Hourly curve: max per UTC hour across the window plus today.
    const byHour = Array.from({ length: 24 }, (_, hourUTC) => ({
      hourUTC,
      playersOnline: 0,
      playersInGame: 0,
    }));
    const foldHour = (h: { hourUTC: number; playersOnline: number; playersInGame: number }) => {
      const slot = byHour[h.hourUTC];
      if (!slot) return;
      slot.playersOnline = Math.max(slot.playersOnline, h.playersOnline);
      slot.playersInGame = Math.max(slot.playersInGame, h.playersInGame);
    };
    for (const r of rows) r.hourlyPeaks.forEach(foldHour);
    const todayRow = await readToday(ctx, now);
    todayRow.hourlyPeaks.forEach(foldHour);

    // Retention over cohorts whose check day falls inside the window.
    const cohortPoints = (key: "d1" | "d7" | "d30", n: number) => {
      const from = addDays(windowStart, -n);
      const to = addDays(today, -n);
      return allRows
        .filter((r) => r.date >= from && r.date < to && r.retention?.[key])
        .map((r) => r.retention![key]!);
    };
    const d1 = ratio(cohortPoints("d1", 1));
    const d7 = ratio(cohortPoints("d7", 7));
    const d30 = ratio(cohortPoints("d30", 30));

    const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0);
    const funnel = {
      visited: sum((r) => r.uniqueVisitors),
      joined: sum((r) => r.uniquePlayers),
      started: sum((r) => r.playersInStartedGames),
      completed: sum((r) => r.playersInCompletedGames),
    };

    const searches = new Map<string, number>();
    const phases = new Map<string, number>();
    for (const r of rows) {
      for (const s of r.topNoResultSearches) searches.set(s.query, (searches.get(s.query) ?? 0) + s.count);
      for (const [phase, count] of Object.entries(r.abandonedByPhase)) {
        phases.set(phase, (phases.get(phase) ?? 0) + count);
      }
    }
    const topNoResultSearches = [...searches.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, 15)
      .map(([query, count]) => ({ query, count }));
    const abandonmentByPhase = [...phases.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([phase, count]) => ({ phase, count }));

    return {
      today: todayRow,
      days: daysOut,
      hourlyPeaks: byHour,
      retention: {
        d1: d1.rate,
        d7: d7.rate,
        d30: d30.rate,
        cohortSize: d1.cohort,
        cohorts: { d1: d1.cohort, d7: d7.cohort, d30: d30.cohort },
      },
      funnel,
      topNoResultSearches,
      abandonmentByPhase,
    };
  },
});
