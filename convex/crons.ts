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

export default crons;


