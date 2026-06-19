import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";

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
      // Track where games die (everything except a finished game = abandonment)
      if (r.phase !== "gameOver") {
        await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
          eventType: "game_abandoned",
          metadata: { phase: r.phase, roundNumber: r.currentRound },
        });
      }
      await ctx.db.delete(r._id);
    }
  },
});

/**
 * Cleanup inactive players (10 minute timeout)
 * Removes players who haven't sent a heartbeat in 10+ minutes
 * Reassigns host if needed, deletes empty rooms
 */
export const cleanupInactivePlayers = internalMutation({
  args: {},
  handler: async (ctx) => {
    const TIMEOUT = 10 * 60 * 1000; // 10 minutes
    const cutoff = now() - TIMEOUT;

    const allPlayers = await ctx.db.query("players").collect();
    const stalePlayers = allPlayers.filter((p) => p.lastSeenAt < cutoff);

    if (stalePlayers.length > 0) {
      console.log(`[cleanupInactivePlayers] Found ${stalePlayers.length} inactive players`);
    }

    // Group stale players by room to efficiently handle room cleanup
    const playersByRoom = new Map<string, typeof stalePlayers>();
    for (const player of stalePlayers) {
      const roomPlayers = playersByRoom.get(player.roomCode) || [];
      roomPlayers.push(player);
      playersByRoom.set(player.roomCode, roomPlayers);
    }

    // Process each room
    for (const [roomCode, staleRoomPlayers] of playersByRoom.entries()) {
      const room = await ctx.db
        .query("rooms")
        .withIndex("by_code", (q) => q.eq("code", roomCode))
        .unique();

      if (!room) {
        // Room already deleted, just clean up players
        for (const player of staleRoomPlayers) {
          await ctx.db.delete(player._id);
        }
        continue;
      }

      // Delete all stale players in this room
      for (const player of staleRoomPlayers) {
        console.log(`[cleanupInactivePlayers] Removing inactive player ${player.playerId} from room ${roomCode}`);
        await ctx.db.delete(player._id);
      }

      // Check remaining players
      const remainingPlayers = await ctx.db
        .query("players")
        .withIndex("by_room", (q) => q.eq("roomCode", roomCode))
        .collect();

      // If room is now empty, delete it
      if (remainingPlayers.length === 0) {
        console.log(`[cleanupInactivePlayers] Room ${roomCode} is now empty - deleting`);
        await deleteRoomAndData(ctx, room);
        continue;
      }

      // If host was removed, reassign host
      const hostWasRemoved = room.hostPlayerId && staleRoomPlayers.some(
        (p) => p._id.id === room.hostPlayerId!.id
      );

      if (hostWasRemoved) {
        const sortedRemaining = [...remainingPlayers].sort((a, b) => a._creationTime - b._creationTime);
        if (sortedRemaining[0]) {
          await ctx.db.patch(room._id, { hostPlayerId: sortedRemaining[0]._id });
          await ctx.db.patch(sortedRemaining[0]._id, { isHost: true });
          console.log(`[cleanupInactivePlayers] Host reassigned to ${sortedRemaining[0].playerId} in room ${roomCode}`);
        }
      }

      if (room.phase === "songSelection") {
        const submissions = await ctx.db
          .query("submissions")
          .withIndex("by_room_round", (q) => q.eq("roomCode", roomCode).eq("round", room.currentRound))
          .collect();
        const submittedPlayerIds = new Set(submissions.map((submission) => submission.playerId));
        const allRemainingSubmitted = remainingPlayers.every((player) =>
          submittedPlayerIds.has(player.playerId)
        );

        if (submissions.length > 0 && allRemainingSubmitted) {
          await ctx.scheduler.runAfter(0, internal.game.flow.startRatingPhaseInternal, {
            code: roomCode,
            round: room.currentRound,
          });
        }
      }
    }
  },
});

async function deleteRoomAndData(ctx: any, room: any) {
  const code = room.code;

  // Delete all associated data in order
  const players = await ctx.db.query("players").withIndex("by_room", (q: any) => q.eq("roomCode", code)).collect();
  for (const player of players) {
    await ctx.db.delete(player._id);
  }

  const submissions = await ctx.db.query("submissions").withIndex("by_room_round", (q: any) => q.eq("roomCode", code)).collect();
  for (const submission of submissions) {
    await ctx.db.delete(submission._id);
  }

  const ratings = await ctx.db.query("ratings").withIndex("by_room_round", (q: any) => q.eq("roomCode", code)).collect();
  for (const rating of ratings) {
    await ctx.db.delete(rating._id);
  }

  const results = await ctx.db.query("roundResults").withIndex("by_room_round", (q: any) => q.eq("roomCode", code)).collect();
  for (const result of results) {
    await ctx.db.delete(result._id);
  }

  const customPrompts = await ctx.db.query("customPrompts").withIndex("by_room", (q: any) => q.eq("roomCode", code)).collect();
  for (const prompt of customPrompts) {
    await ctx.db.delete(prompt._id);
  }

  // Track where games die (room emptied out before finishing)
  if (room.phase !== "gameOver") {
    await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
      eventType: "game_abandoned",
      metadata: { phase: room.phase, roundNumber: room.currentRound },
    });
  }

  // Finally delete the room itself
  await ctx.db.delete(room._id);

  console.log(`[deleteRoomAndData] Deleted room ${code} and all associated data`);
}


