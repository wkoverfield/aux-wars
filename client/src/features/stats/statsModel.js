/**
 * Pure helpers for the /stats page: read the admin key from storage, normalize
 * the Convex stats payloads into one stable shape, and format numbers.
 *
 * The page renders against these normalized shapes only, so a fresh
 * deployment with no rollup rows (nulls, empty arrays, missing fields) renders
 * empty states instead of throwing.
 */

export const STATS_KEY_STORAGE = "aux-wars-stats-key";
export const WINDOWS = [7, 30];
const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Key storage (localStorage can throw in private mode or when blocked)
// ---------------------------------------------------------------------------

export function readStoredKey(storage = globalThis.localStorage) {
  try {
    const value = storage?.getItem(STATS_KEY_STORAGE);
    return value && value.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

export function writeStoredKey(key, storage = globalThis.localStorage) {
  try {
    storage?.setItem(STATS_KEY_STORAGE, key);
    return true;
  } catch {
    return false;
  }
}

export function clearStoredKey(storage = globalThis.localStorage) {
  try {
    storage?.removeItem(STATS_KEY_STORAGE);
  } catch {
    /* nothing to clear */
  }
}

// ---------------------------------------------------------------------------
// Primitive coercion
// ---------------------------------------------------------------------------

export function num(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function firstNum(...values) {
  for (const value of values) {
    const n = num(value);
    if (n !== null) return n;
  }
  return null;
}

/** Ratio in 0..1. Accepts a 0..1 ratio or a 0..100 percentage. */
export function ratio(value) {
  const n = num(value);
  if (n === null || n < 0) return null;
  return n > 1 ? Math.min(n / 100, 1) : n;
}

function safeDivide(a, b) {
  const x = num(a);
  const y = num(b);
  if (x === null || y === null || y <= 0) return null;
  return x / y;
}

/** Timestamp in ms from a number (ms) or a parseable date string. */
export function toMs(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

// ---------------------------------------------------------------------------
// UTC dates
// ---------------------------------------------------------------------------

export function utcDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The last `days` complete UTC dates, oldest first, ending yesterday. Today
 * is still accumulating and is shown separately as "Today so far".
 */
export function windowDates(days, nowMs = Date.now()) {
  const todayStart = Date.parse(`${utcDate(nowMs)}T00:00:00Z`);
  const dates = [];
  for (let i = days; i >= 1; i -= 1) dates.push(utcDate(todayStart - i * DAY_MS));
  return dates;
}

// ---------------------------------------------------------------------------
// Daily rollup rows
// ---------------------------------------------------------------------------

export function normalizeDay(row) {
  if (!row || typeof row !== "object") return null;
  const date = typeof row.date === "string" ? row.date.slice(0, 10) : null;
  const gamesStarted = num(row.gamesStarted);
  const gamesCompleted = num(row.gamesCompleted);
  return {
    date,
    gamesCreated: num(row.gamesCreated),
    gamesStarted,
    gamesCompleted,
    gamesAbandoned: num(row.gamesAbandoned),
    completionRate: ratio(row.completionRate) ?? safeDivide(gamesCompleted, gamesStarted),
    playerJoins: num(row.playerJoins),
    uniquePlayers: num(row.uniquePlayers),
    avgPlayersPerGame: num(row.avgPlayersPerGame),
    maxPlayersPerGame: num(row.maxPlayersPerGame),
    songsSubmitted: num(row.songsSubmitted),
    ratingsSubmitted: num(row.ratingsSubmitted),
    homepageUniques: firstNum(row.homepageUniques, row.uniqueVisitors),
    homepagePageviews: firstNum(row.homepagePageviews, row.pageviews),
    peakPlayersOnline: num(row.peakPlayersOnline),
    peakPlayersInGame: num(row.peakPlayersInGame),
    peakHourUTC: num(row.peakHourUTC),
    searchNoResults: num(row.searchNoResults),
    searchFailed: num(row.searchFailed),
  };
}

/**
 * Map rollup rows onto the fixed date window. Dates with no row become
 * `{ date, missing: true }` so charts keep a stable x-axis with visible gaps.
 */
export function alignToWindow(rows, days, nowMs = Date.now()) {
  const byDate = new Map();
  for (const raw of Array.isArray(rows) ? rows : []) {
    const day = normalizeDay(raw);
    if (day?.date) byDate.set(day.date, day);
  }
  return windowDates(days, nowMs).map((date) => byDate.get(date) ?? { date, missing: true });
}

function sumField(days, field) {
  let total = 0;
  let seen = false;
  for (const day of days) {
    const n = num(day[field]);
    if (n !== null) {
      total += n;
      seen = true;
    }
  }
  return seen ? total : null;
}

function maxField(days, field) {
  let best = null;
  for (const day of days) {
    const n = num(day[field]);
    if (n !== null && (best === null || n > best)) best = n;
  }
  return best;
}

/** Window-level totals for the trend headers. */
export function summarizeWindow(days) {
  const present = days.filter((d) => !d.missing);
  const gamesStarted = sumField(present, "gamesStarted");
  const gamesCompleted = sumField(present, "gamesCompleted");
  const playerDays = sumField(present, "uniquePlayers");
  const withGames = present.filter((d) => num(d.avgPlayersPerGame) !== null && num(d.gamesStarted) > 0);
  const seats = withGames.reduce((acc, d) => acc + d.avgPlayersPerGame * d.gamesStarted, 0);
  const seatGames = withGames.reduce((acc, d) => acc + d.gamesStarted, 0);
  return {
    daysWithData: present.length,
    gamesStarted,
    gamesPerDay: gamesStarted === null || present.length === 0 ? null : gamesStarted / present.length,
    uniquePlayersPerDay: playerDays === null || present.length === 0 ? null : playerDays / present.length,
    completionRate: safeDivide(gamesCompleted, gamesStarted),
    avgPlayersPerGame: seatGames > 0 ? seats / seatGames : null,
    peakPlayersOnline: maxField(present, "peakPlayersOnline"),
  };
}

// ---------------------------------------------------------------------------
// Live payload
// ---------------------------------------------------------------------------

function normalizeNow(raw) {
  const src = raw?.now ?? raw?.live ?? raw ?? {};
  return {
    playersOnline: num(src.playersOnline),
    playersInGame: num(src.playersInGame),
    activeRooms: num(src.activeRooms),
    activeGames: num(src.activeGames),
    sampledAt: toMs(src.sampledAt ?? src.at ?? src.updatedAt),
  };
}

function normalizePeak(raw) {
  const src = raw?.allTimePeak ?? raw?.peak ?? raw?.record ?? null;
  if (!src || typeof src !== "object") return null;
  const peak = {
    playersOnline: num(src.playersOnline),
    playersOnlineAt: toMs(src.playersOnlineAt ?? src.at ?? src.timestamp),
    playersInGame: num(src.playersInGame),
    // An explicit null means "not recorded"; only a missing field falls back
    // to the shared timestamp.
    playersInGameAt: toMs("playersInGameAt" in src ? src.playersInGameAt : (src.at ?? src.timestamp)),
  };
  return peak.playersOnline === null && peak.playersInGame === null ? null : peak;
}

export function normalizeLive(raw) {
  const today = normalizeDay(raw?.today ?? null);
  return {
    now: normalizeNow(raw),
    peak: normalizePeak(raw),
    today: today && Object.values(today).some((v) => typeof v === "number") ? today : null,
    hourly: normalizeHourly(raw?.hourlyPeaks ?? raw?.hourly),
  };
}

// ---------------------------------------------------------------------------
// Dashboard payload
// ---------------------------------------------------------------------------

/**
 * Hourly peak rows, oldest first. Each row is either an absolute hour
 * (`hourStart`/`hour` as ms or ISO) or a UTC hour of day (`hourUTC` 0..23).
 */
export function normalizeHourly(rows) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const start = toMs(row.hourStart ?? row.hour ?? row.timestamp);
    const hourUTC = num(row.hourUTC) ?? (start !== null ? new Date(start).getUTCHours() : null);
    if (hourUTC === null) continue;
    out.push({
      start,
      hourUTC,
      playersOnline: firstNum(row.peakPlayersOnline, row.playersOnline, row.maxPlayersOnline),
      playersInGame: firstNum(row.peakPlayersInGame, row.playersInGame, row.maxPlayersInGame),
    });
  }
  out.sort((a, b) => (a.start ?? a.hourUTC) - (b.start ?? b.hourUTC));
  return out;
}

function normalizeRetentionPoint(value, cohortSize = null) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return { rate: ratio(value), returned: null, cohort: num(cohortSize) };
  if (typeof value !== "object") return null;
  const returned = num(value.returned);
  const cohort = firstNum(value.cohort, value.eligible, value.total);
  const rate = ratio(value.rate) ?? safeDivide(returned, cohort);
  return rate === null && cohort === null ? null : { rate, returned, cohort };
}

/**
 * `{ d1, d7, d30 }` where each point is a rate (0..1), a percentage, or
 * `{ returned, cohort }`. A sibling `cohorts: { d1: n }` map supplies cohort
 * sizes for bare rates.
 */
export function normalizeRetention(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const cohorts = src.cohorts && typeof src.cohorts === "object" ? src.cohorts : {};
  return {
    d1: normalizeRetentionPoint(src.d1, cohorts.d1),
    d7: normalizeRetentionPoint(src.d7, cohorts.d7),
    d30: normalizeRetentionPoint(src.d30, cohorts.d30),
  };
}

export const FUNNEL_STEPS = [
  { key: "visited", label: "Visited", aliases: ["visitors"] },
  { key: "joined", label: "Joined a game", aliases: ["played", "players"] },
  { key: "started", label: "Started a game", aliases: [] },
  { key: "completed", label: "Finished a game", aliases: [] },
];

export function normalizeFunnel(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const steps = FUNNEL_STEPS.map((step) => ({
    key: step.key,
    label: step.label,
    value: firstNum(src[step.key], ...step.aliases.map((a) => src[a])),
  }));
  const top = steps[0].value;
  return steps.map((step, i) => ({
    ...step,
    ofTop: safeDivide(step.value, top),
    ofPrevious: i === 0 ? null : safeDivide(step.value, steps[i - 1].value),
  }));
}

/** `[{ label, count }]` from an array of rows or a `{ label: count }` map, largest first. */
export function normalizeCounts(raw, labelKeys) {
  let rows = [];
  if (Array.isArray(raw)) {
    rows = raw.map((row) => {
      if (!row || typeof row !== "object") return null;
      const label = labelKeys.map((k) => row[k]).find((v) => typeof v === "string" && v);
      return { label: label ?? "unknown", count: firstNum(row.count, row.value) };
    });
  } else if (raw && typeof raw === "object") {
    rows = Object.entries(raw).map(([label, count]) => ({ label, count: num(count) }));
  }
  return rows
    .filter((row) => row && row.count !== null && row.count > 0)
    .sort((a, b) => b.count - a.count);
}

/** Quick Play window totals (stats.getDashboard `quickPlay`). */
export function normalizeQuickPlay(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    clicks: num(src.clicks),
    matched: num(src.matched),
    matchRate: ratio(src.matchRate),
    medianWaitMs: num(src.medianWaitMs),
    leftWaiting: num(src.leftWaiting),
    abandonRate: ratio(src.abandonRate),
    gamesStarted: num(src.gamesStarted),
    avgPlayersAtStart: num(src.avgPlayersAtStart),
    oneVOneOffered: num(src.oneVOneOffered),
    oneVOneAccepted: num(src.oneVOneAccepted),
  };
}

/** A wait in seconds or minutes ("42s", "1m 5s"). */
export function fmtWait(ms) {
  const n = num(ms);
  if (n === null) return EMPTY;
  const total = Math.round(n / 1000);
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const sec = total % 60;
  return sec ? `${m}m ${sec}s` : `${m}m`;
}

export function normalizeDashboard(raw, windowDays, nowMs = Date.now()) {
  const src = raw && typeof raw === "object" ? raw : {};
  const dailyRows = src.days ?? src.daily ?? src.dailyMetrics ?? [];
  const days = alignToWindow(dailyRows, windowDays, nowMs);
  const today = normalizeDay(src.today ?? null);
  return {
    days,
    summary: summarizeWindow(days),
    today: today && Object.values(today).some((v) => typeof v === "number") ? today : null,
    hourly: normalizeHourly(src.hourlyPeaks ?? src.hourly),
    retention: normalizeRetention(src.retention),
    funnel: normalizeFunnel(src.funnel),
    noResultSearches: normalizeCounts(
      src.topNoResultSearches ?? src.noResultSearches ?? src.searchNoResults,
      ["term", "label", "query"],
    ),
    searches: normalizeSearches(src.searches),
    abandonment: normalizeCounts(src.abandonmentByPhase ?? src.abandonment, ["phase", "label"]),
    quickPlay: normalizeQuickPlay(src.quickPlay),
    speed: normalizeSpeed(src.speed),
  };
}

// Google's Core Web Vitals thresholds: at or under `good` is good, over
// `poor` is poor, in between needs improvement. Times in ms, CLS unitless.
export const VITAL_THRESHOLDS = {
  LCP: { good: 2500, poor: 4000 },
  INP: { good: 200, poor: 500 },
  CLS: { good: 0.1, poor: 0.25 },
  FCP: { good: 1800, poor: 3000 },
};
export const SPEED_METRICS = ["LCP", "INP", "CLS", "FCP"];
export const SPEED_DEVICES = ["all", "mobile", "chromebook", "desktop"];

export function vitalRating(metric, value) {
  const t = VITAL_THRESHOLDS[metric];
  const n = num(value);
  if (!t || n === null) return null;
  if (n <= t.good) return "good";
  return n <= t.poor ? "needs-improvement" : "poor";
}

export function fmtVital(metric, value) {
  const n = num(value);
  if (n === null) return EMPTY;
  if (metric === "CLS") return n.toFixed(2);
  return n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`;
}

/**
 * Speed card: p75 per metric and device class (null when no samples), plus
 * error counts.
 */
export function normalizeSpeed(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const list = Array.isArray(src.vitals) ? src.vitals : [];
  const cell = (metric, device) => {
    const hit = list.find((v) => v && v.metric === metric && v.deviceClass === device);
    const p75 = hit ? num(hit.p75) : null;
    return { p75, samples: hit ? num(hit.samples) ?? 0 : 0, rating: vitalRating(metric, p75) };
  };
  const rows = SPEED_METRICS.map((metric) => ({
    metric,
    cells: Object.fromEntries(SPEED_DEVICES.map((d) => [d, cell(metric, d)])),
  }));
  const errors = src.errors && typeof src.errors === "object" ? src.errors : {};
  return {
    rows,
    hasData: rows.some((r) => r.cells.all.samples > 0),
    samples: Object.fromEntries(SPEED_DEVICES.map((d) => [d, Math.max(0, ...rows.map((r) => r.cells[d].samples))])),
    errors: { client: num(errors.client) ?? 0, boundary: num(errors.boundary) ?? 0 },
  };
}

/** Window totals of empty vs failed searches, with failures by reason. */
export function normalizeSearches(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    noResults: num(src.noResults),
    failed: num(src.failed),
    failedByReason: normalizeCounts(src.failedByReason, ["reason", "label"]),
  };
}

// ---------------------------------------------------------------------------
// Formatting (no em dashes: empty values read "n/a")
// ---------------------------------------------------------------------------

export const EMPTY = "n/a";

export function fmtInt(value) {
  const n = num(value);
  return n === null ? EMPTY : Math.round(n).toLocaleString();
}

export function fmtDecimal(value, digits = 1) {
  const n = num(value);
  return n === null ? EMPTY : n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function fmtPct(value) {
  const r = ratio(value);
  if (r === null) return EMPTY;
  const pct = r * 100;
  return `${pct < 10 && pct > 0 ? pct.toFixed(1) : Math.round(pct)}%`;
}

/** Absolute timestamp in UTC, matching the UTC-keyed rollups. */
export function fmtDateTime(ms) {
  if (num(ms) === null) return EMPTY;
  const text = new Date(ms).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "UTC",
  });
  return `${text} UTC`;
}

export function fmtShortDate(date) {
  if (!date) return EMPTY;
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms)) return date;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

export function fmtHourUTC(hour) {
  const n = num(hour);
  return n === null ? EMPTY : `${String(n).padStart(2, "0")}:00 UTC`;
}
