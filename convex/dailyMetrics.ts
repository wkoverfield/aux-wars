import { v, type Infer } from "convex/values";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
  type QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { dailyMetricsFields } from "./schema";
import { readCounter } from "./siteStats";
import { searchFailReason } from "./analytics";

/**
 * Permanent daily rollups.
 *
 * One dailyMetrics row per UTC date, never pruned. A daily cron rebuilds the
 * previous day from raw analyticsEvents (paginated by_type_and_timestamp
 * ranges; the raw table keeps 90 days), pageview counters, visitorFirstSeen and
 * concurrencyStats. Rebuilding a date replaces its row, so re-running is safe.
 *
 * Retention: a date's new-visitor cohort is checked against pageviewVisits on
 * exactly date+1, date+7 and date+30. Each rollup fills both directions (its
 * own cohort for check dates already past, and older cohorts for which it is
 * the check date), so the order dates are rolled up in does not matter.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const EVENT_PAGE_SIZE = 2000;
const COHORT_PAGE_SIZE = 1000;
const TOP_SEARCHES_PER_DAY = 20;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const dstr = (ms: number) => new Date(ms).toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
export const dayStartMs = (date: string) => Date.parse(`${date}T00:00:00.000Z`);
export const addDays = (date: string, n: number) => dstr(dayStartMs(date) + n * DAY_MS);

export const RETENTION_OFFSETS = [
  { key: "d1", days: 1 },
  { key: "d7", days: 7 },
  { key: "d30", days: 30 },
] as const;
export type RetentionKey = (typeof RETENTION_OFFSETS)[number]["key"];

// Event types whose metadata the rollup needs, and types it only counts.
export const DETAIL_EVENT_TYPES = [
  "game_started",
  "game_completed",
  "game_abandoned",
  "player_joined",
  "search_no_results",
  "search_failed",
  "quickplay_matched",
  "quickplay_left_waiting",
  "web_vital",
] as const;
export const COUNT_EVENT_TYPES = [
  "game_created",
  "song_submitted",
  "rating_submitted",
  "pro_purchased",
  "quickplay_clicked",
  "quickplay_1v1_offered",
  "quickplay_1v1_accepted",
  "client_error",
  "client_error_boundary",
] as const;
type DetailType = (typeof DETAIL_EVENT_TYPES)[number];
type CountType = (typeof COUNT_EVENT_TYPES)[number];

/** The metadata fields the rollup reads, nothing else. */
export type SlimEvent = {
  roomCode?: string;
  playerId?: string;
  visitorId?: string;
  playerCount?: number;
  phase?: string;
  label?: string;
  reason?: string;
  waitedMs?: number;
  playersAtStart?: number;
  name?: string;
  value?: number;
  deviceClass?: string;
};

export function slimEvent(metadata: unknown): SlimEvent {
  const m = (metadata ?? {}) as Record<string, unknown>;
  const out: SlimEvent = {};
  if (typeof m.roomCode === "string") out.roomCode = m.roomCode;
  if (typeof m.playerId === "string") out.playerId = m.playerId;
  if (typeof m.visitorId === "string") out.visitorId = m.visitorId;
  if (typeof m.playerCount === "number") out.playerCount = m.playerCount;
  if (typeof m.phase === "string") out.phase = m.phase;
  if (typeof m.label === "string") out.label = m.label;
  if (typeof m.reason === "string") out.reason = m.reason;
  if (typeof m.waitedMs === "number") out.waitedMs = m.waitedMs;
  if (typeof m.playersAtStart === "number") out.playersAtStart = m.playersAtStart;
  if (typeof m.name === "string") out.name = m.name;
  if (typeof m.value === "number") out.value = m.value;
  if (typeof m.deviceClass === "string") out.deviceClass = m.deviceClass;
  return out;
}

export type DayEvents = {
  detail: Record<DetailType, SlimEvent[]>;
  counts: Record<CountType, number>;
};

export type HourPeak = { hourUTC: number; playersOnline: number; playersInGame: number };

export type DayInputs = {
  date: string;
  computedAt: number;
  events: DayEvents;
  pageviews: number;
  uniqueVisitors: number;
  // null when visitorFirstSeen has no history covering this date
  newVisitors: number | null;
  newVisitorsPlayed: number | null;
  newPlayers: number | null;
  // null when concurrency sampling had not started by this date
  hours: HourPeak[] | null;
};

const dailyMetricsRowValidator = v.object(dailyMetricsFields);
export type DailyMetricsRow = Infer<typeof dailyMetricsRowValidator>;

const round = (n: number, places: number) => {
  const f = 10 ** places;
  return Math.round(n * f) / f;
};

/** Nearest-rank percentile of an ascending array (p in 0..1). */
export function percentile(sortedAsc: number[], p: number): number | null {
  if (sortedAsc.length === 0) return null;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.ceil(p * sortedAsc.length) - 1));
  return sortedAsc[idx];
}

/** Stable identity for a joining player: visitor id when sent, else player id. */
function playerKey(e: SlimEvent): string | null {
  if (e.visitorId) return `v:${e.visitorId}`;
  if (e.playerId) return `p:${e.playerId}`;
  return null;
}

/** Record keys must be plain field names in Convex. */
function phaseKey(phase: string | undefined): string {
  return phase && /^[A-Za-z0-9]{1,40}$/.test(phase) ? phase : "unknown";
}

export const VITAL_METRICS = ["LCP", "INP", "CLS", "FCP", "TTFB"] as const;
export const VITAL_DEVICE_CLASSES = ["mobile", "chromebook", "desktop"] as const;

export type VitalStat = { metric: string; deviceClass: string; p75: number; samples: number };

/**
 * p75 and sample count per metric, overall (deviceClass "all") and per known
 * device class. Combinations with no samples are omitted.
 */
export function summarizeVitals(events: SlimEvent[]): VitalStat[] {
  const groups = new Map<string, number[]>();
  const push = (metric: string, deviceClass: string, value: number) => {
    const key = `${metric}|${deviceClass}`;
    const arr = groups.get(key);
    if (arr) arr.push(value);
    else groups.set(key, [value]);
  };
  for (const e of events) {
    if (!e.name || !(VITAL_METRICS as readonly string[]).includes(e.name)) continue;
    if (typeof e.value !== "number" || !Number.isFinite(e.value)) continue;
    push(e.name, "all", e.value);
    if (e.deviceClass && (VITAL_DEVICE_CLASSES as readonly string[]).includes(e.deviceClass)) {
      push(e.name, e.deviceClass, e.value);
    }
  }
  const out: VitalStat[] = [];
  for (const metric of VITAL_METRICS) {
    for (const deviceClass of ["all", ...VITAL_DEVICE_CLASSES]) {
      const values = groups.get(`${metric}|${deviceClass}`);
      if (!values) continue;
      values.sort((a, b) => a - b);
      out.push({ metric, deviceClass, p75: percentile(values, 0.75)!, samples: values.length });
    }
  }
  return out;
}

export function normalizeSearch(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 80);
}

/** Pure: turns one day's inputs into a dailyMetrics row. */
export function computeDayMetrics(input: DayInputs): DailyMetricsRow {
  const { detail, counts } = input.events;

  const started = detail.game_started;
  const completed = detail.game_completed;
  const joins = detail.player_joined;

  // Players per game, over games started that day.
  const sizes = started
    .map((e) => e.playerCount)
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b);
  const avgPlayersPerGame =
    sizes.length > 0 ? round(sizes.reduce((s, n) => s + n, 0) / sizes.length, 2) : null;

  const completionRate =
    started.length > 0 ? round(Math.min(1, completed.length / started.length), 4) : null;

  // Distinct players, and which of them sat in a room that started / completed.
  const startedRooms = new Set(started.map((e) => e.roomCode).filter(Boolean));
  const completedRooms = new Set(completed.map((e) => e.roomCode).filter(Boolean));
  const players = new Set<string>();
  const inStarted = new Set<string>();
  const inCompleted = new Set<string>();
  let joinsWithVisitorId = 0;
  for (const j of joins) {
    if (j.visitorId) joinsWithVisitorId++;
    const key = playerKey(j);
    if (!key) continue;
    players.add(key);
    if (j.roomCode && startedRooms.has(j.roomCode)) inStarted.add(key);
    if (j.roomCode && completedRooms.has(j.roomCode)) inCompleted.add(key);
  }

  const playerSeatsCompleted = completed.reduce(
    (s, e) => s + (typeof e.playerCount === "number" ? e.playerCount : 0),
    0
  );

  const abandonedByPhase: Record<string, number> = {};
  for (const e of detail.game_abandoned) {
    const k = phaseKey(e.phase);
    abandonedByPhase[k] = (abandonedByPhase[k] ?? 0) + 1;
  }

  const searchCounts = new Map<string, number>();
  for (const e of detail.search_no_results) {
    if (!e.label) continue;
    const q = normalizeSearch(e.label);
    if (!q) continue;
    searchCounts.set(q, (searchCounts.get(q) ?? 0) + 1);
  }
  const topNoResultSearches = [...searchCounts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, TOP_SEARCHES_PER_DAY)
    .map(([query, count]) => ({ query, count }));

  const searchFailedByReason: Record<string, number> = {};
  for (const e of detail.search_failed) {
    const k = searchFailReason(e.reason);
    searchFailedByReason[k] = (searchFailedByReason[k] ?? 0) + 1;
  }

  let peakPlayersOnline: number | null = null;
  let peakPlayersInGame: number | null = null;
  let peakHourUTC: number | null = null;
  let hourlyPeaks: HourPeak[] = [];
  if (input.hours) {
    hourlyPeaks = [...input.hours].sort((a, b) => a.hourUTC - b.hourUTC);
    peakPlayersOnline = 0;
    peakPlayersInGame = 0;
    for (const h of hourlyPeaks) {
      if (h.playersOnline > peakPlayersOnline) {
        peakPlayersOnline = h.playersOnline;
        peakHourUTC = h.hourUTC;
      }
      if (h.playersInGame > peakPlayersInGame) peakPlayersInGame = h.playersInGame;
    }
  }

  // Quick Play funnel. Matched and clicks are per player; games started and
  // players at start come from game_started events labelled "quickplay".
  const qpClicks = counts.quickplay_clicked ?? 0;
  const qpMatched = detail.quickplay_matched ?? [];
  const qpWaits = qpMatched
    .map((e) => e.waitedMs)
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b);
  const qpStartSizes = started
    .filter((e) => e.label === "quickplay")
    .map((e) => e.playerCount)
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0);

  const newVisitors = input.newVisitors;
  const returningVisitors =
    newVisitors === null ? null : Math.max(0, input.uniqueVisitors - newVisitors);

  return {
    date: input.date,
    computedAt: input.computedAt,
    gamesCreated: counts.game_created,
    gamesStarted: started.length,
    gamesCompleted: completed.length,
    gamesAbandoned: detail.game_abandoned.length,
    abandonedByPhase,
    completionRate,
    playerJoins: joins.length,
    uniquePlayers: players.size,
    joinsWithVisitorId,
    playersInStartedGames: inStarted.size,
    playersInCompletedGames: inCompleted.size,
    playerSeatsCompleted,
    avgPlayersPerGame,
    p90PlayersPerGame: percentile(sizes, 0.9),
    maxPlayersPerGame: sizes.length > 0 ? sizes[sizes.length - 1] : null,
    songsSubmitted: counts.song_submitted,
    ratingsSubmitted: counts.rating_submitted,
    pageviews: input.pageviews,
    uniqueVisitors: input.uniqueVisitors,
    newVisitors,
    returningVisitors,
    newVisitorsPlayed: newVisitors === null ? null : input.newVisitorsPlayed,
    newPlayers: input.newPlayers,
    peakPlayersOnline,
    peakPlayersInGame,
    peakHourUTC,
    proPurchases: counts.pro_purchased,
    searchNoResults: detail.search_no_results.length,
    topNoResultSearches,
    searchFailed: detail.search_failed.length,
    searchFailedByReason,
    hourlyPeaks,
    quickPlayClicks: qpClicks,
    quickPlayMatched: qpMatched.length,
    quickPlayMatchRate: qpClicks > 0 ? round(Math.min(1, qpMatched.length / qpClicks), 4) : null,
    quickPlayMedianWaitMs: percentile(qpWaits, 0.5),
    quickPlayLeftWaiting: (detail.quickplay_left_waiting ?? []).length,
    quickPlayGamesStarted: qpStartSizes.length,
    quickPlayAvgPlayersAtStart:
      qpStartSizes.length > 0
        ? round(qpStartSizes.reduce((s, n) => s + n, 0) / qpStartSizes.length, 2)
        : null,
    quickPlay1v1Offered: counts.quickplay_1v1_offered ?? 0,
    quickPlay1v1Accepted: counts.quickplay_1v1_accepted ?? 0,
    webVitals: summarizeVitals(detail.web_vital ?? []),
    clientErrors: counts.client_error ?? 0,
    clientErrorBoundaries: counts.client_error_boundary ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Reads (all bounded: indexed ranges, paginated or capped)
// ---------------------------------------------------------------------------

/** One page of a single event type's events in [start, end). */
export const eventsPage = internalQuery({
  args: {
    eventType: v.string(),
    start: v.number(),
    end: v.number(),
    cursor: v.union(v.string(), v.null()),
    detail: v.boolean(),
  },
  handler: async (ctx, { eventType, start, end, cursor, detail }) => {
    const page = await ctx.db
      .query("analyticsEvents")
      .withIndex("by_type_and_timestamp", (q) =>
        q.eq("eventType", eventType).gte("timestamp", start).lt("timestamp", end)
      )
      .paginate({ cursor, numItems: EVENT_PAGE_SIZE });
    return {
      count: page.page.length,
      events: detail ? page.page.map((e) => slimEvent(e.metadata)) : [],
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

async function collectDayEvents(ctx: ActionCtx, start: number, end: number): Promise<DayEvents> {
  const read = async (eventType: string, detail: boolean) => {
    const events: SlimEvent[] = [];
    let count = 0;
    let cursor: string | null = null;
    for (;;) {
      const page: {
        count: number;
        events: SlimEvent[];
        isDone: boolean;
        continueCursor: string;
      } = await ctx.runQuery(internal.dailyMetrics.eventsPage, {
        eventType,
        start,
        end,
        cursor,
        detail,
      });
      count += page.count;
      if (detail) events.push(...page.events);
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    return { events, count };
  };
  const detailEntries = await Promise.all(
    DETAIL_EVENT_TYPES.map(async (t) => [t, (await read(t, true)).events] as const)
  );
  const countEntries = await Promise.all(
    COUNT_EVENT_TYPES.map(async (t) => [t, (await read(t, false)).count] as const)
  );
  return {
    detail: Object.fromEntries(detailEntries) as DayEvents["detail"],
    counts: Object.fromEntries(countEntries) as DayEvents["counts"],
  };
}

/** Capped, in-query read of one event type (for today's partial numbers). */
export async function readEventsCapped(
  ctx: QueryCtx,
  eventType: string,
  start: number,
  cap: number
): Promise<{ events: SlimEvent[]; truncated: boolean }> {
  const rows = await ctx.db
    .query("analyticsEvents")
    .withIndex("by_type_and_timestamp", (q) => q.eq("eventType", eventType).gte("timestamp", start))
    .take(cap + 1);
  return {
    events: rows.slice(0, cap).map((e) => slimEvent(e.metadata)),
    truncated: rows.length > cap,
  };
}

export async function readPageviewDay(ctx: QueryCtx, date: string) {
  return {
    pageviews: await readCounter(ctx, `day:${date}`),
    uniqueVisitors: await readCounter(ctx, `uvday:${date}`),
  };
}

/**
 * Hour rows for a date, or null when concurrency sampling had not started by
 * then (so a missing history reads as unknown, not as zero players).
 */
export async function readHourPeaks(ctx: QueryCtx, date: string): Promise<HourPeak[] | null> {
  const earliest = await ctx.db
    .query("concurrencyStats")
    .withIndex("by_kind_and_hourStart", (q) => q.eq("kind", "hour"))
    .order("asc")
    .first();
  if (!earliest?.date || earliest.date > date) return null;
  const rows = await ctx.db
    .query("concurrencyStats")
    .withIndex("by_kind_and_date", (q) => q.eq("kind", "hour").eq("date", date))
    .take(48);
  return rows.map((r) => ({
    hourUTC: r.hourUTC ?? new Date(r.hourStart).getUTCHours(),
    playersOnline: r.playersOnline,
    playersInGame: r.playersInGame,
  }));
}

/** Everything about a date that is a handful of point reads. */
export const dayContext = internalQuery({
  args: { date: v.string() },
  handler: async (ctx, { date }) => {
    const { pageviews, uniqueVisitors } = await readPageviewDay(ctx, date);
    const hours = await readHourPeaks(ctx, date);
    const earliestSeen = await ctx.db
      .query("visitorFirstSeen")
      .withIndex("by_firstSeenDate")
      .order("asc")
      .first();
    const earliestPlayed = await ctx.db
      .query("visitorFirstSeen")
      .withIndex("by_firstPlayedDate", (q) => q.gt("firstPlayedDate", ""))
      .order("asc")
      .first();
    return {
      pageviews,
      uniqueVisitors,
      hours,
      earliestSeenDate: earliestSeen?.firstSeenDate ?? null,
      earliestPlayedDate: earliestPlayed?.firstPlayedDate ?? null,
    };
  },
});

/**
 * One page of a date's new-visitor cohort. Counts the page, how many played
 * that same day, and (with checkDate) how many had a pageview on checkDate.
 */
export const cohortPage = internalQuery({
  args: {
    cohortDate: v.string(),
    checkDate: v.union(v.string(), v.null()),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, { cohortDate, checkDate, cursor }) => {
    const page = await ctx.db
      .query("visitorFirstSeen")
      .withIndex("by_firstSeenDate", (q) => q.eq("firstSeenDate", cohortDate))
      .paginate({ cursor, numItems: COHORT_PAGE_SIZE });
    let playedSameDay = 0;
    let returned = 0;
    for (const row of page.page) {
      if (row.firstPlayedDate === cohortDate) playedSameDay++;
      if (checkDate) {
        const visit = await ctx.db
          .query("pageviewVisits")
          .withIndex("by_date_and_visitor", (q) =>
            q.eq("date", checkDate).eq("visitorId", row.visitorId)
          )
          .first();
        if (visit) returned++;
      }
    }
    return {
      count: page.page.length,
      playedSameDay,
      returned,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

/** One page of visitors whose first play was on a date. */
export const firstPlayedPage = internalQuery({
  args: { date: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { date, cursor }) => {
    const page = await ctx.db
      .query("visitorFirstSeen")
      .withIndex("by_firstPlayedDate", (q) => q.eq("firstPlayedDate", date))
      .paginate({ cursor, numItems: COHORT_PAGE_SIZE });
    return { count: page.page.length, isDone: page.isDone, continueCursor: page.continueCursor };
  },
});

type CohortTotals = { count: number; playedSameDay: number; returned: number };

async function cohortTotals(
  ctx: ActionCtx,
  cohortDate: string,
  checkDate: string | null
): Promise<CohortTotals> {
  const totals: CohortTotals = { count: 0, playedSameDay: 0, returned: 0 };
  let cursor: string | null = null;
  for (;;) {
    const page: CohortTotals & { isDone: boolean; continueCursor: string } = await ctx.runQuery(
      internal.dailyMetrics.cohortPage,
      { cohortDate, checkDate, cursor }
    );
    totals.count += page.count;
    totals.playedSameDay += page.playedSameDay;
    totals.returned += page.returned;
    if (page.isDone) break;
    cursor = page.continueCursor;
  }
  return totals;
}

async function countFirstPlayed(ctx: ActionCtx, date: string): Promise<number> {
  let total = 0;
  let cursor: string | null = null;
  for (;;) {
    const page: { count: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(
      internal.dailyMetrics.firstPlayedPage,
      { date, cursor }
    );
    total += page.count;
    if (page.isDone) break;
    cursor = page.continueCursor;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Rollup
// ---------------------------------------------------------------------------

const retentionEntry = v.object({
  date: v.string(),
  key: v.union(v.literal("d1"), v.literal("d7"), v.literal("d30")),
  cohort: v.number(),
  returned: v.number(),
});

/**
 * Upserts one date's row (replacing everything but retention) and applies
 * retention results to whichever cohort rows exist.
 */
export const writeDay = internalMutation({
  args: { row: dailyMetricsRowValidator, retention: v.array(retentionEntry) },
  handler: async (ctx, { row, retention }) => {
    const existing = await ctx.db
      .query("dailyMetrics")
      .withIndex("by_date", (q) => q.eq("date", row.date))
      .unique();
    const own = { ...(existing?.retention ?? {}) };
    for (const r of retention) {
      if (r.date === row.date) own[r.key] = { cohort: r.cohort, returned: r.returned };
    }
    const next = { ...row, ...(Object.keys(own).length > 0 ? { retention: own } : {}) };
    if (existing) await ctx.db.replace(existing._id, next);
    else await ctx.db.insert("dailyMetrics", next);

    let cohortRowsPatched = 0;
    for (const r of retention) {
      if (r.date === row.date) continue;
      const cohortRow = await ctx.db
        .query("dailyMetrics")
        .withIndex("by_date", (q) => q.eq("date", r.date))
        .unique();
      if (!cohortRow) continue;
      await ctx.db.patch(cohortRow._id, {
        retention: { ...(cohortRow.retention ?? {}), [r.key]: { cohort: r.cohort, returned: r.returned } },
      });
      cohortRowsPatched++;
    }
    return { action: existing ? "replaced" : "inserted", cohortRowsPatched };
  },
});

/**
 * A cohort date is usable when visitorFirstSeen history starts strictly
 * before it. On the first covered date every visitor looks new.
 */
function cohortCovered(cohortDate: string, earliestSeenDate: string | null): boolean {
  return earliestSeenDate !== null && cohortDate > earliestSeenDate;
}

export async function runRollup(ctx: ActionCtx, date: string, now: number) {
  const today = dstr(now);
  if (!DATE_RE.test(date) || dstr(dayStartMs(date)) !== date) {
    throw new Error(`Invalid date ${date}`);
  }
  if (date >= today) throw new Error(`Refusing to roll up ${date}: the day is not over`);

  const start = dayStartMs(date);
  const events = await collectDayEvents(ctx, start, start + DAY_MS);
  const context: {
    pageviews: number;
    uniqueVisitors: number;
    hours: HourPeak[] | null;
    earliestSeenDate: string | null;
    earliestPlayedDate: string | null;
  } = await ctx.runQuery(internal.dailyMetrics.dayContext, { date });

  let newVisitors: number | null = null;
  let newVisitorsPlayed: number | null = null;
  if (cohortCovered(date, context.earliestSeenDate)) {
    const own = await cohortTotals(ctx, date, null);
    newVisitors = own.count;
    newVisitorsPlayed = own.playedSameDay;
  }
  const newPlayers =
    context.earliestPlayedDate !== null && date > context.earliestPlayedDate
      ? await countFirstPlayed(ctx, date)
      : null;

  const row = computeDayMetrics({
    date,
    computedAt: now,
    events,
    pageviews: context.pageviews,
    uniqueVisitors: context.uniqueVisitors,
    newVisitors,
    newVisitorsPlayed,
    newPlayers,
    hours: context.hours,
  });

  // Retention both ways: older cohorts checked on this date, and this date's
  // cohort checked on later dates that are already over.
  const retention: Array<{ date: string; key: RetentionKey; cohort: number; returned: number }> = [];
  for (const { key, days } of RETENTION_OFFSETS) {
    const cohortDate = addDays(date, -days);
    if (cohortCovered(cohortDate, context.earliestSeenDate)) {
      const t = await cohortTotals(ctx, cohortDate, date);
      if (t.count > 0) retention.push({ date: cohortDate, key, cohort: t.count, returned: t.returned });
    }
    const checkDate = addDays(date, days);
    if (checkDate < today && cohortCovered(date, context.earliestSeenDate)) {
      const t = await cohortTotals(ctx, date, checkDate);
      if (t.count > 0) retention.push({ date, key, cohort: t.count, returned: t.returned });
    }
  }

  const result: { action: string; cohortRowsPatched: number } = await ctx.runMutation(
    internal.dailyMetrics.writeDay,
    { row, retention }
  );
  return { date, ...result, retentionPoints: retention.length };
}

/** Rebuilds one UTC date's row. Idempotent. */
export const rollupDay = internalAction({
  args: { date: v.string() },
  handler: async (ctx, { date }) => runRollup(ctx, date, Date.now()),
});

/** Cron entry point: rebuilds yesterday (UTC). */
export const rollupYesterday = internalAction({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    return await runRollup(ctx, dstr(now - DAY_MS), now);
  },
});

/**
 * One-off backfill: schedules rollupDay for every date that still has raw
 * analyticsEvents, oldest first, up to yesterday. Run it BEFORE the raw-event
 * cleanup drains old rows (the cleanup also refuses to delete days without a
 * rollup row). The oldest date may be partial if an earlier prune cut it
 * mid-day; its row reflects the events on hand. Dates with no raw events are
 * left absent rather than estimated.
 * Run siteStats:backfillVisitorFirstSeen first so visitor history exists.
 */
export const backfillDailyMetrics = internalMutation({
  args: {
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    spacingMs: v.optional(v.number()),
  },
  handler: async (ctx, { from, to, spacingMs }) => {
    const oldest = await ctx.db.query("analyticsEvents").withIndex("by_timestamp").order("asc").first();
    if (!oldest) return { scheduled: 0, from: null, to: null };
    const now = Date.now();
    const firstFull = dstr(oldest.timestamp);
    const yesterday = dstr(now - DAY_MS);
    const start = from && DATE_RE.test(from) && from > firstFull ? from : firstFull;
    const end = to && DATE_RE.test(to) && to < yesterday ? to : yesterday;
    const spacing = Math.max(0, spacingMs ?? 2000);
    let scheduled = 0;
    for (let d = start; d <= end; d = addDays(d, 1)) {
      await ctx.scheduler.runAfter(scheduled * spacing, internal.dailyMetrics.rollupDay, { date: d });
      scheduled++;
    }
    return { scheduled, from: start, to: end };
  },
});
