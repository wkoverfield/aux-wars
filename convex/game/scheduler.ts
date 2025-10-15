import { internalMutation } from "../_generated/server";

function now() { return Date.now(); }

export const cleanupStaleRooms = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = now() - 24 * 60 * 60 * 1000;
    const rooms = await ctx.db.query("rooms").collect();
    const stale = rooms.filter((r) => r.lastActivityAt < cutoff);
    for (const r of stale) {
      const code = r.code;
      const players = await ctx.db
        .query("players")
        .withIndex("by_room", (q) => q.eq("roomCode", code))
        .collect();
      for (const p of players) await ctx.db.delete(p._id);
      const subs = await ctx.db
        .query("submissions")
        .withIndex("by_room_round", (q) => q.eq("roomCode", code))
        .collect();
      for (const s of subs) await ctx.db.delete(s._id);
      const results = await ctx.db
        .query("roundResults")
        .withIndex("by_room_round", (q) => q.eq("roomCode", code))
        .collect();
      for (const rr of results) await ctx.db.delete(rr._id);
      const ratings = await ctx.db
        .query("ratings")
        .withIndex("by_room_round", (q) => q.eq("roomCode", code))
        .collect();
      for (const rt of ratings) await ctx.db.delete(rt._id);
      await ctx.db.delete(r._id);
    }
  },
});



