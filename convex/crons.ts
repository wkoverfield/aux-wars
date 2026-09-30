import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "cleanup-inactive-players",
  { minutes: 5 },  // Run every 5 minutes (2x within 10-min disconnect timeout)
  internal.game.scheduler.cleanupInactivePlayers
);

crons.interval(
  "cleanup-stale-rooms",
  { minutes: 10 },  // Cheap pass: only sweeps rooms idle past the 24h cutoff
  internal.game.scheduler.cleanupStaleRooms
);

crons.interval(
  "sample-concurrency",
  { seconds: 60 }, // action: read-only sample query, then a concurrencyStats-only write
  internal.concurrency.sampleAndRecord
);

crons.daily(
  "rollup-daily-metrics",
  { hourUTC: 0, minuteUTC: 20 }, // yesterday's permanent row, well before the 4am raw-event prune
  internal.dailyMetrics.rollupYesterday
);

crons.daily(
  "cleanup-old-analytics",
  { hourUTC: 4, minuteUTC: 0 },  // Run daily at 4am UTC
  internal.analytics.cleanupOldEvents,
  { retentionDays: 90 }
);

crons.daily(
  "prune-pageview-visits",
  { hourUTC: 4, minuteUTC: 30 }, // shortly after analytics cleanup
  internal.siteStats.pruneVisits
);

crons.interval(
  "refresh-live-stats",
  { seconds: 60 }, // homepage counters; writes only when a number changed
  internal.analytics.refreshLiveStats
);

crons.daily(
  "daily metric snapshot",
  { hourUTC: 8, minuteUTC: 10 }, // stable once-daily capture of cumulative counters
  internal.metricsRollup.snapshotDailyMetrics
);

export default crons;


