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
  type ErrorKind,
  type SlowInteraction,
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
const LIVE_COUNT_TYPES = [
  "game_created",
  "pro_purchased",
  "quickplay_clicked",
  "quickplay_1v1_offered",
  "quickplay_1v1_accepted",
] as const;

// Sampled web vitals are the highest-volume detail type; today's partial row
// skips them (the Speed card uses completed days only).
const SKIP_TODAY_DETAIL = new Set<string>(["web_vital"]);

type VitalDay = {
  webVitals?: Array<{ metric: string; deviceClass: string; p75: number; samples: number }>;
  slowInteractions?: SlowInteraction[];
  clientErrors?: number;
  clientErrorBoundaries?: number;
  clientErrorKinds?: ErrorKind[];
};

/**
 * Slow-interaction groups merged across days: samples and slow counts add up;
 * p75, phase means and mobile share are sample-weighted means of the daily
 * values (an approximation across days, like the vitals p75).
 */
export function mergeSlowInteractions(days: VitalDay[], keep = 8) {
  type Acc = {
    route: string; target: string; samples: number; slow: number; p75w: number; mobilew: number;
    phaseSamples: number; inputw: number; procw: number; presw: number; scripts: Map<string, number>;
  };
  const acc = new Map<string, Acc>();
  for (const d of days) {
    for (const s of d.slowInteractions ?? []) {
      const key = `${s.route}|${s.target}`;
      const a = acc.get(key) ?? {
        route: s.route, target: s.target, samples: 0, slow: 0, p75w: 0, mobilew: 0,
        phaseSamples: 0, inputw: 0, procw: 0, presw: 0, scripts: new Map<string, number>(),
      };
      a.samples += s.samples;
      a.slow += s.slow;
      a.p75w += s.p75 * s.samples;
      a.mobilew += s.mobileShare * s.samples;
      if (s.inputDelay !== null && s.processing !== null && s.presentation !== null) {
        a.phaseSamples += s.samples;
        a.inputw += s.inputDelay * s.samples;
        a.procw += s.processing * s.samples;
        a.presw += s.presentation * s.samples;
      }
      if (s.script) a.scripts.set(s.script, (a.scripts.get(s.script) ?? 0) + s.samples);
      acc.set(key, a);
    }
  }
  const per = (w: number, n: number) => (n > 0 ? Math.round(w / n) : null);
  return [...acc.values()]
    .map((a) => ({
      route: a.route,
      target: a.target,
      samples: a.samples,
      slow: a.slow,
      p75: Math.round(a.p75w / a.samples),
      inputDelay: per(a.inputw, a.phaseSamples),
      processing: per(a.procw, a.phaseSamples),
      presentation: per(a.presw, a.phaseSamples),
      mobileShare: Math.round((a.mobilew / a.samples) * 100) / 100,
      script: [...a.scripts.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null,
    }))
    .sort((x, y) => y.slow - x.slow || y.p75 - x.p75)
    .slice(0, keep);
}

/** Error kinds summed across days, largest first. */
export function mergeErrorKinds(days: VitalDay[], keep = 12): ErrorKind[] {
  const acc = new Map<string, ErrorKind>();
  for (const d of days) {
    for (const e of d.clientErrorKinds ?? []) {
      const key = `${e.kind}|${e.name}|${e.route}`;
      const cur = acc.get(key) ?? { ...e, count: 0 };
      cur.count += e.count;
      acc.set(key, cur);
    }
  }
  return [...acc.values()].sort((a, b) => b.count - a.count).slice(0, keep);
}

/**
 * Speed card over a set of day rows. Rows keep no raw samples, so a window's
 * p75 is the sample-weighted mean of the daily p75s (exact for a single day,
 * an approximation across days).
 */
export function summarizeSpeed(days: VitalDay[]) {
  const acc = new Map<string, { metric: string; deviceClass: string; weighted: number; samples: number }>();
  let clientErrors = 0;
  let boundaryErrors = 0;
  for (const d of days) {
    clientErrors += d.clientErrors ?? 0;
    boundaryErrors += d.clientErrorBoundaries ?? 0;
    for (const s of d.webVitals ?? []) {
      if (!(s.samples > 0)) continue;
      const key = `${s.metric}|${s.deviceClass}`;
      const cur = acc.get(key) ?? { metric: s.metric, deviceClass: s.deviceClass, weighted: 0, samples: 0 };
      cur.weighted += s.p75 * s.samples;
      cur.samples += s.samples;
      acc.set(key, cur);
    }
  }
  const vitals = [...acc.values()].map((a) => ({
    metric: a.metric,
    deviceClass: a.deviceClass,
    p75: a.metric === "CLS" ? Math.round((a.weighted / a.samples) * 1000) / 1000 : Math.round(a.weighted / a.samples),
    samples: a.samples,
  }));
  return { vitals, errors: { client: clientErrors, boundary: boundaryErrors } };
}

type QuickPlayDay = {
  quickPlayClicks?: number;
  quickPlayMatched?: number;
  quickPlayMedianWaitMs?: number | null;
  quickPlayLeftWaiting?: number;
  quickPlayGamesStarted?: number;
  quickPlayAvgPlayersAtStart?: number | null;
  quickPlay1v1Offered?: number;
  quickPlay1v1Accepted?: number;
};

/**
 * Quick Play card totals over a set of day rows. Median wait across days is
 * the match-weighted median of the daily medians (rows keep no raw waits).
 */
export function summarizeQuickPlay(days: QuickPlayDay[]) {
  let clicks = 0;
  let matched = 0;
  let leftWaiting = 0;
  let gamesStarted = 0;
  let playersAtStart = 0;
  let oneVOneOffered = 0;
  let oneVOneAccepted = 0;
  const medians: Array<{ ms: number; weight: number }> = [];
  for (const d of days) {
    clicks += d.quickPlayClicks ?? 0;
    matched += d.quickPlayMatched ?? 0;
    leftWaiting += d.quickPlayLeftWaiting ?? 0;
    const games = d.quickPlayGamesStarted ?? 0;
    gamesStarted += games;
    if (games > 0 && typeof d.quickPlayAvgPlayersAtStart === "number") {
      playersAtStart += d.quickPlayAvgPlayersAtStart * games;
    }
    oneVOneOffered += d.quickPlay1v1Offered ?? 0;
    oneVOneAccepted += d.quickPlay1v1Accepted ?? 0;
    if (typeof d.quickPlayMedianWaitMs === "number" && (d.quickPlayMatched ?? 0) > 0) {
      medians.push({ ms: d.quickPlayMedianWaitMs, weight: d.quickPlayMatched ?? 0 });
    }
  }
  medians.sort((a, b) => a.ms - b.ms);
  const totalWeight = medians.reduce((s, m) => s + m.weight, 0);
  let medianWaitMs: number | null = null;
  let acc = 0;
  for (const m of medians) {
    acc += m.weight;
    if (acc * 2 >= totalWeight) {
      medianWaitMs = m.ms;
      break;
    }
  }
  const rate = (n: number, d: number) => (d > 0 ? Math.round(Math.min(1, n / d) * 10000) / 10000 : null);
  return {
    clicks,
    matched,
    matchRate: rate(matched, clicks),
    medianWaitMs,
    leftWaiting,
    abandonRate: rate(leftWaiting, clicks),
    gamesStarted,
    avgPlayersAtStart: gamesStarted > 0 ? Math.round((playersAtStart / gamesStarted) * 100) / 100 : null,
    oneVOneOffered,
    oneVOneAccepted,
  };
}

async function readToday(ctx: QueryCtx, now: number) {
  const date = dstr(now);
  const start = dayStartMs(date);
  let truncated = false;
  const detail = {} as DayEvents["detail"];
  for (const t of DETAIL_EVENT_TYPES) {
    if (SKIP_TODAY_DETAIL.has(t)) {
      detail[t] = [];
      continue;
    }
    const r = await readEventsCapped(ctx, t, start, TODAY_EVENT_CAP);
    detail[t] = r.events;
    truncated ||= r.truncated;
  }
  // Low-volume count types are read live; songs and ratings are not (below).
  const counts = Object.fromEntries(COUNT_EVENT_TYPES.map((t) => [t, 0])) as DayEvents["counts"];
  for (const t of LIVE_COUNT_TYPES) {
    const r = await readEventsCapped(ctx, t, start, TODAY_EVENT_CAP);
    counts[t] = r.events.length;
    truncated ||= r.truncated;
  }

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
    let searchNoResults = 0;
    let searchFailed = 0;
    const failReasons = new Map<string, number>();
    for (const r of rows) {
      searchNoResults += r.searchNoResults;
      searchFailed += r.searchFailed ?? 0;
      for (const [reason, count] of Object.entries(r.searchFailedByReason ?? {})) {
        failReasons.set(reason, (failReasons.get(reason) ?? 0) + count);
      }
    }
    const searchFailedByReason = [...failReasons.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .map(([reason, count]) => ({ reason, count }));

    const topNoResultSearches = [...searches.entries()]
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, 15)
      .map(([query, count]) => ({ query, count }));
    const abandonmentByPhase = [...phases.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([phase, count]) => ({ phase, count }));

    return {
      today: todayRow,
      // Window days plus today so far (Quick Play is new; today matters).
      quickPlay: summarizeQuickPlay([...rows, todayRow]),
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
      searches: { noResults: searchNoResults, failed: searchFailed, failedByReason: searchFailedByReason },
      abandonmentByPhase,
      // Vitals from completed days only; error counts include today so far.
      speed: {
        ...summarizeSpeed(rows),
        errors: summarizeSpeed([...rows, todayRow]).errors,
        slowInteractions: mergeSlowInteractions(rows),
        errorKinds: mergeErrorKinds([...rows, todayRow]),
      },
    };
  },
});
