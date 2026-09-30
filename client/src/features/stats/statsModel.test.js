import { describe, expect, it } from "vitest";
import {
  STATS_KEY_STORAGE,
  alignToWindow,
  clearStoredKey,
  fmtDateTime,
  fmtInt,
  fmtPct,
  normalizeCounts,
  normalizeDashboard,
  normalizeFunnel,
  normalizeHourly,
  normalizeLive,
  normalizeRetention,
  readStoredKey,
  summarizeWindow,
  windowDates,
  writeStoredKey,
} from "./statsModel";

const NOW = Date.parse("2026-09-30T15:00:00Z");

function throwingStorage() {
  return {
    getItem: () => { throw new Error("blocked"); },
    setItem: () => { throw new Error("blocked"); },
    removeItem: () => { throw new Error("blocked"); },
  };
}

describe("key storage", () => {
  it("round-trips a trimmed key", () => {
    localStorage.clear();
    expect(writeStoredKey("abc")).toBe(true);
    expect(localStorage.getItem(STATS_KEY_STORAGE)).toBe("abc");
    expect(readStoredKey()).toBe("abc");
    clearStoredKey();
    expect(readStoredKey()).toBeNull();
  });

  it("treats blank values as no key", () => {
    localStorage.setItem(STATS_KEY_STORAGE, "   ");
    expect(readStoredKey()).toBeNull();
    localStorage.clear();
  });

  it("never throws when storage is blocked", () => {
    const storage = throwingStorage();
    expect(readStoredKey(storage)).toBeNull();
    expect(writeStoredKey("abc", storage)).toBe(false);
    expect(() => clearStoredKey(storage)).not.toThrow();
  });
});

describe("date window", () => {
  it("ends yesterday UTC, oldest first", () => {
    expect(windowDates(3, NOW)).toEqual(["2026-09-27", "2026-09-28", "2026-09-29"]);
  });

  it("marks dates without a rollup row as missing", () => {
    const days = alignToWindow([{ date: "2026-09-28", gamesStarted: 4, gamesCompleted: 3 }], 3, NOW);
    expect(days.map((d) => Boolean(d.missing))).toEqual([true, false, true]);
    expect(days[1].completionRate).toBe(0.75);
  });

  it("handles a fresh deployment with no rows", () => {
    const days = alignToWindow(undefined, 7, NOW);
    expect(days).toHaveLength(7);
    expect(days.every((d) => d.missing)).toBe(true);
    expect(summarizeWindow(days)).toMatchObject({
      daysWithData: 0,
      gamesStarted: null,
      completionRate: null,
      avgPlayersPerGame: null,
      peakPlayersOnline: null,
    });
  });
});

describe("summarizeWindow", () => {
  it("weights players per game by games and ignores missing days", () => {
    const days = alignToWindow(
      [
        { date: "2026-09-28", gamesStarted: 2, gamesCompleted: 1, avgPlayersPerGame: 3, uniquePlayers: 6, peakPlayersOnline: 9 },
        { date: "2026-09-29", gamesStarted: 6, gamesCompleted: 6, avgPlayersPerGame: 5, uniquePlayers: 20, peakPlayersOnline: 14 },
      ],
      3,
      NOW,
    );
    const s = summarizeWindow(days);
    expect(s.daysWithData).toBe(2);
    expect(s.gamesStarted).toBe(8);
    expect(s.gamesPerDay).toBe(4);
    expect(s.uniquePlayersPerDay).toBe(13);
    expect(s.completionRate).toBe(7 / 8);
    expect(s.avgPlayersPerGame).toBe((2 * 3 + 6 * 5) / 8);
    expect(s.peakPlayersOnline).toBe(14);
  });
});

describe("normalizeLive", () => {
  it("reads nested now, peak and today", () => {
    const live = normalizeLive({
      now: { playersOnline: 12, playersInGame: 8, activeRooms: 3, activeGames: 2 },
      allTimePeak: { playersOnline: 40, playersOnlineAt: NOW - 1000, playersInGame: 30, playersInGameAt: NOW - 2000 },
      today: { date: "2026-09-30", gamesStarted: 5 },
    });
    expect(live.now).toMatchObject({ playersOnline: 12, playersInGame: 8, activeRooms: 3, activeGames: 2 });
    expect(live.peak).toMatchObject({ playersOnline: 40, playersInGame: 30, playersOnlineAt: NOW - 1000 });
    expect(live.today.gamesStarted).toBe(5);
  });

  it("returns empty shapes for null", () => {
    const live = normalizeLive(null);
    expect(live.now.playersOnline).toBeNull();
    expect(live.peak).toBeNull();
    expect(live.today).toBeNull();
    expect(live.hourly).toEqual([]);
  });
});

describe("normalizeHourly", () => {
  it("accepts absolute hours and sorts oldest first", () => {
    const rows = normalizeHourly([
      { hourStart: Date.parse("2026-09-30T02:00:00Z"), peakPlayersOnline: 5 },
      { hour: "2026-09-30T01:00:00Z", playersOnline: 3, playersInGame: 2 },
      null,
    ]);
    expect(rows.map((r) => r.hourUTC)).toEqual([1, 2]);
    expect(rows[0]).toMatchObject({ playersOnline: 3, playersInGame: 2 });
  });

  it("accepts hour-of-day rows", () => {
    expect(normalizeHourly([{ hourUTC: 20, peakPlayersOnline: 7 }, { hourUTC: 3 }]).map((r) => r.hourUTC)).toEqual([3, 20]);
  });
});

describe("normalizeRetention", () => {
  it("accepts rates, percentages and counts", () => {
    const r = normalizeRetention({ d1: 0.25, d7: { returned: 3, cohort: 12 }, d30: 40 });
    expect(r.d1.rate).toBe(0.25);
    expect(r.d7).toEqual({ rate: 0.25, returned: 3, cohort: 12 });
    expect(r.d30.rate).toBe(0.4);
    expect(normalizeRetention(undefined)).toEqual({ d1: null, d7: null, d30: null });
  });
});

describe("normalizeFunnel", () => {
  it("computes conversion from the top and previous step", () => {
    const steps = normalizeFunnel({ visited: 200, joined: 50, started: 40, completed: 20 });
    expect(steps.map((s) => s.value)).toEqual([200, 50, 40, 20]);
    expect(steps[1].ofTop).toBe(0.25);
    expect(steps[3].ofPrevious).toBe(0.5);
  });

  it("keeps steps but no ratios when empty", () => {
    const steps = normalizeFunnel(null);
    expect(steps).toHaveLength(4);
    expect(steps.every((s) => s.value === null && s.ofTop === null)).toBe(true);
  });
});

describe("normalizeCounts", () => {
  it("accepts a map or rows and sorts descending", () => {
    expect(normalizeCounts({ lobby: 2, rating: 5, voting: 0 }, ["phase"])).toEqual([
      { label: "rating", count: 5 },
      { label: "lobby", count: 2 },
    ]);
    expect(normalizeCounts([{ term: "a", count: 1 }, { term: "b", count: 3 }], ["term"]).map((r) => r.label)).toEqual(["b", "a"]);
  });
});

describe("convex/stats.ts payloads", () => {
  it("reads the flat getLive shape", () => {
    const live = normalizeLive({
      playersOnline: 6,
      playersInGame: 4,
      activeRooms: 2,
      activeGames: 1,
      sampledAt: NOW,
      allTimePeak: { playersOnline: 30, playersInGame: 22, at: NOW - 5000, playersInGameAt: null },
    });
    expect(live.now).toEqual({ playersOnline: 6, playersInGame: 4, activeRooms: 2, activeGames: 1, sampledAt: NOW });
    expect(live.peak).toEqual({ playersOnline: 30, playersOnlineAt: NOW - 5000, playersInGame: 22, playersInGameAt: null });
  });

  it("reads the getDashboard shape", () => {
    const d = normalizeDashboard(
      {
        today: { date: "2026-09-30", gamesStarted: 3, gamesCompleted: 1, uniqueVisitors: 40, completionRate: null, partial: true },
        days: [{ date: "2026-09-29", gamesStarted: 10, gamesCompleted: 6, completionRate: 0.6, uniqueVisitors: 100, pageviews: 300, hourlyPeaks: [] }],
        hourlyPeaks: Array.from({ length: 24 }, (_, hourUTC) => ({ hourUTC, playersOnline: hourUTC === 20 ? 9 : 0, playersInGame: 0 })),
        retention: { d1: 0.2, d7: null, d30: null, cohortSize: 50, cohorts: { d1: 50, d7: 0, d30: 0 } },
        funnel: { visited: 100, joined: 30, started: 20, completed: 12 },
        topNoResultSearches: [{ query: "obscure song", count: 2 }],
        abandonmentByPhase: [{ phase: "lobby", count: 3 }],
      },
      7,
      NOW,
    );
    expect(d.today).toMatchObject({ gamesStarted: 3, homepageUniques: 40, completionRate: 1 / 3 });
    expect(d.days[6]).toMatchObject({ date: "2026-09-29", completionRate: 0.6, homepageUniques: 100, homepagePageviews: 300 });
    expect(d.hourly).toHaveLength(24);
    expect(d.hourly[20].playersOnline).toBe(9);
    expect(d.retention.d1).toEqual({ rate: 0.2, returned: null, cohort: 50 });
    expect(d.retention.d7).toBeNull();
    expect(d.funnel.map((s) => s.value)).toEqual([100, 30, 20, 12]);
    expect(d.noResultSearches).toEqual([{ label: "obscure song", count: 2 }]);
    expect(d.abandonment).toEqual([{ label: "lobby", count: 3 }]);
  });
});

describe("normalizeDashboard", () => {
  it("survives an empty payload", () => {
    const d = normalizeDashboard(null, 30, NOW);
    expect(d.days).toHaveLength(30);
    expect(d.hourly).toEqual([]);
    expect(d.noResultSearches).toEqual([]);
    expect(d.abandonment).toEqual([]);
  });
});

describe("formatting", () => {
  it("never renders an em dash for empty values", () => {
    expect(fmtInt(null)).not.toContain("—");
    expect(fmtPct(undefined)).not.toContain("—");
  });

  it("formats timestamps in UTC and says so", () => {
    expect(fmtDateTime(Date.parse("2026-09-30T20:05:00Z"))).toBe("Sep 30, 2026, 20:05 UTC");
    expect(fmtDateTime(null)).not.toContain("UTC");
  });

  it("formats percentages", () => {
    expect(fmtPct(0.5)).toBe("50%");
    expect(fmtPct(0.034)).toBe("3.4%");
    expect(fmtPct(0)).toBe("0%");
  });
});
