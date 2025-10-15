import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.interval(
  "cleanup-stale-rooms",
  { minutes: 10 },
  internal.game.scheduler.cleanupStaleRooms
);

export default crons;


