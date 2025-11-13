import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "cleanup-inactive-players",
  { minutes: 1 },  // Run every minute to quickly remove inactive players
  internal.game.scheduler.cleanupInactivePlayers
);

crons.interval(
  "cleanup-stale-rooms",
  { minutes: 10 },  // Keep 10 minute interval for full room cleanup
  internal.game.scheduler.cleanupStaleRooms
);

export default crons;


