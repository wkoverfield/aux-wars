import { internalMutation } from "../_generated/server";
import { internal } from "../_generated/api";
import { presence } from "../presence";

function now() { return Date.now(); }

// Stale-room cutoff. Generous on purpose: lastActivityAt only moves on real
// game actions (join/leave/submit/vote/phase advance) — never on heartbeats —
// so a connected-but-idle lobby can sit for hours. The presence online-check
// below is the hard guard; this cutoff just bounds how long a truly abandoned
// room can linger.
export const STALE_ROOM_CUTOFF_MS = 24 * 60 * 60 * 1000; // 24 hours

// Player timeout. The presence component flips a player offline ~75s after
// their last heartbeat (2.5x the 30s interval), or instantly on clean tab
// close / hidden tab. We then give them this long to come back (refresh,
// reopen tab) before removing them from the room. 30 min because real
// sessions run hours and phones lock between turns; hidden tab = offline,
// so this is the whole grace window for a backgrounded player.
export const PLAYER_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Deletes rooms with no real game activity past the cutoff.
 * NEVER deletes a room the presence component reports anyone online in —
 * connected-but-idle is alive, not stale.
 */
export const cleanupStaleRooms = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = now() - STALE_ROOM_CUTOFF_MS;
    const rooms = await ctx.db.query("rooms").collect();
    for (const room of rooms) {
      if (room.lastActivityAt >= cutoff) continue;
      const online = await presence.listRoom(ctx, room.code, true);
      if (online.length > 0) continue;
      console.log(`[cleanupStaleRooms] Room ${room.code} idle since ${new Date(room.lastActivityAt).toISOString()} with nobody online - deleting`);
      await deleteRoomAndData(ctx, room);
    }
  },
});

/**
 * Cleanup disconnected players. Connectedness is judged from the presence
 * component (not game-doc timestamps): a player is removed only if presence
 * reports them offline and their last disconnect (or join, if they never
 * registered presence) is older than PLAYER_TIMEOUT_MS.
 * Reassigns host if needed, deletes empty rooms.
 */
export const cleanupInactivePlayers = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = now() - PLAYER_TIMEOUT_MS;

    const allPlayers = await ctx.db.query("players").collect();

    // Group players by room so we fetch presence state once per room
    const playersByRoom = new Map<string, typeof allPlayers>();
    for (const player of allPlayers) {
      const roomPlayers = playersByRoom.get(player.roomCode) || [];
      roomPlayers.push(player);
      playersByRoom.set(player.roomCode, roomPlayers);
    }

    for (const [roomCode, roomPlayers] of playersByRoom.entries()) {
      const room = await ctx.db
        .query("rooms")
        .withIndex("by_code", (q) => q.eq("code", roomCode))
        .unique();

      if (!room) {
        // Room already deleted, just clean up orphaned players
        for (const player of roomPlayers) {
          await ctx.db.delete(player._id);
        }
        continue;
      }

      // Presence component state is the source of truth for connectedness.
      const entries = await presence.listRoom(ctx, roomCode, false);
      const presenceByUser = new Map(entries.map((e) => [e.userId, e]));

      const stalePlayers = roomPlayers.filter((player) => {
        const entry = presenceByUser.get(player.playerId);
        if (entry?.online) return false; // connected — never stale
        // Last evidence of life: presence disconnect time, else join time
        // (covers players that never sent a presence heartbeat).
        const lastSeen = entry
          ? entry.lastDisconnected
          : (player.connectedAt ?? player._creationTime);
        return lastSeen < cutoff;
      });

      if (stalePlayers.length === 0) continue;

      // Remove the stale players (and their presence rows)
      for (const player of stalePlayers) {
        console.log(`[cleanupInactivePlayers] Removing disconnected player ${player.playerId} from room ${roomCode}`);
        await ctx.db.delete(player._id);
        await presence.removeRoomUser(ctx, roomCode, player.playerId);
      }

      // Check remaining players
      const remainingPlayers = await ctx.db
        .query("players")
        .withIndex("by_room", (q) => q.eq("roomCode", roomCode))
        .collect();

      // If room is now empty, delete it (defensive: unless presence still
      // reports someone online — the stale-room sweep will get it later).
      if (remainingPlayers.length === 0) {
        const online = await presence.listRoom(ctx, roomCode, true);
        if (online.length === 0) {
          console.log(`[cleanupInactivePlayers] Room ${roomCode} is now empty - deleting`);
          await deleteRoomAndData(ctx, room);
        }
        continue;
      }

      // If host was removed, reassign host. Convex Ids are branded strings:
      // compare them directly (`.id` does not exist on them; `a.id === b.id`
      // is undefined === undefined, which made this true for EVERY sweep).
      const hostWasRemoved = room.hostPlayerId && stalePlayers.some(
        (p) => p._id === room.hostPlayerId
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

  const rateLimits = await ctx.db.query("playerRateLimits").withIndex("by_room", (q: any) => q.eq("roomCode", code)).collect();
  for (const row of rateLimits) {
    await ctx.db.delete(row._id);
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

  // Clear the room's presence state in the component too.
  await presence.removeRoom(ctx, code);

  console.log(`[deleteRoomAndData] Deleted room ${code} and all associated data`);
}


