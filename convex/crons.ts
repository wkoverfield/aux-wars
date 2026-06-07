import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "cleanup-inactive-players",
  { minutes: 5 },  // Run every 5 minutes (2x within 10-min timeout is sufficient)
  internal.game.scheduler.cleanupInactivePlayers
);

crons.interval(
  "cleanup-stale-rooms",
  { minutes: 10 },  // Keep 10 minute interval for full room cleanup
  internal.game.scheduler.cleanupStaleRooms
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

export default crons;


