import { v } from "convex/values";
import { mutation, query } from "../_generated/server";

function now() {
  return Date.now();
}

export const hostGame = mutation({
  args: {},
  handler: async (ctx) => {
    const code = await generateUniqueCode(ctx);
    await ctx.db.insert("rooms", {
      code,
      phase: "lobby",
      currentRound: 1,
      currentPrompt: undefined,
      hostPlayerId: undefined,
      settings: {
        numberOfRounds: 3,
        roundLength: 30,
        selectedPrompts: defaultPrompts,
      },
      createdAt: now(),
      lastActivityAt: now(),
    });
    return { code };
  },
});

export const joinGame = mutation({
  args: { code: v.string(), playerId: v.string(), connectionId: v.string(), name: v.string() },
  handler: async (ctx, { code, playerId, connectionId, name }) => {
    const room = await getRoomByCodeInternal(ctx, code);
    if (!room) return { success: false, message: "Game code not found" };

    const players = await ctx.db
      .query("players")
      .withIndex("by_room", (q) => q.eq("roomCode", code))
      .collect();

    const isFirst = players.length === 0;
    const existing = await ctx.db
      .query("players")
      .withIndex("by_player", (q) => q.eq("playerId", playerId).eq("roomCode", code))
      .unique();

    if (existing) {
      // CONNECTION TAKEOVER: This player is rejoining from another tab/device
      // Deactivate the old connection and activate this new one
      const oldConnectionId = existing.connectionId;

      await ctx.db.patch(existing._id, {
        connectionId,           // Update to new connection ID
        name,                   // Update name in case it changed
        connectedAt: now(),     // Record when this connection was established
        lastSeenAt: now(),      // Update last seen
        isActive: true,         // Mark this connection as active
      });

      console.log(`[joinGame] Connection takeover for player ${playerId}: ${oldConnectionId} → ${connectionId}`);

      await touchRoom(ctx, room._id);
      return {
        success: true,
        settings: room.settings,
        playerId,
        tookOver: true,              // Signal that we kicked another connection
        oldConnectionId              // Which connection was replaced
      } as const;
    } else {
      // New player joining for the first time
      const playerDocId = await ctx.db.insert("players", {
        roomCode: code,
        playerId,
        connectionId,
        name,
        isHost: isFirst,
        isReady: false,
        connectedAt: now(),
        lastSeenAt: now(),
        isActive: true,
      });

      if (isFirst) {
        await ctx.db.patch(room._id, { hostPlayerId: playerDocId });
      }

      console.log(`[joinGame] New player joined: ${playerId} with connection ${connectionId}`);

      await touchRoom(ctx, room._id);
      return {
        success: true,
        settings: room.settings,
        playerId,
        tookOver: false
      } as const;
    }
  },
});

export const rejoinGame = mutation({
  args: { code: v.string(), playerId: v.string() },
  handler: async (ctx, { code, playerId }) => {
    const room = await getRoomByCodeInternal(ctx, code);
    if (!room) return { success: false, message: "Game not found" };
    const player = await ctx.db
      .query("players")
      .withIndex("by_player", (q) => q.eq("playerId", playerId).eq("roomCode", code))
      .unique();
    if (!player) return { success: false, message: "Player not found in game" };
    await ctx.db.patch(player._id, { lastSeenAt: now() });
    await touchRoom(ctx, room._id);
    return {
      success: true,
      phase: room.phase,
      currentRound: room.currentRound,
      settings: room.settings,
    };
  },
});

export const leaveGame = mutation({
  args: { code: v.string(), playerId: v.string() },
  handler: async (ctx, { code, playerId }) => {
    const room = await getRoomByCodeInternal(ctx, code);
    if (!room) return;

    const players = await ctx.db
      .query("players")
      .withIndex("by_room", (q) => q.eq("roomCode", code))
      .collect();

    const leaving = players.find((p) => p.playerId === playerId);
    if (leaving) await ctx.db.delete(leaving._id);

    // Check remaining players
    const remaining = await ctx.db
      .query("players")
      .withIndex("by_room", (q) => q.eq("roomCode", code))
      .collect();

    // If room is now empty, delete it immediately
    if (remaining.length === 0) {
      console.log(`[leaveGame] Room ${code} is now empty - deleting`);
      await deleteRoomAndData(ctx, room);
      return { roomDeleted: true } as const;
    }

    // Reassign host if needed
    if (room.hostPlayerId && leaving && room.hostPlayerId.id === leaving._id.id) {
      const sortedRemaining = [...remaining].sort((a, b) => a._creationTime - b._creationTime);
      if (sortedRemaining[0]) {
        await ctx.db.patch(room._id, { hostPlayerId: sortedRemaining[0]._id });
        await ctx.db.patch(sortedRemaining[0]._id, { isHost: true });
        console.log(`[leaveGame] Host reassigned to ${sortedRemaining[0].playerId}`);
      }
    }

    await touchRoom(ctx, room._id);
    return { roomDeleted: false } as const;
  },
});

export const heartbeat = mutation({
  args: { code: v.string(), playerId: v.string(), connectionId: v.string() },
  handler: async (ctx, { code, playerId, connectionId }) => {
    const player = await ctx.db
      .query("players")
      .withIndex("by_player", (q) => q.eq("playerId", playerId).eq("roomCode", code))
      .unique();

    if (!player) {
      return { status: 'NOT_FOUND' } as const;
    }

    // Check if THIS connection is still the active one
    if (player.connectionId !== connectionId) {
      // Another connection has taken over - this tab should disconnect
      return {
        status: 'TAKEN_OVER',
        activeConnectionId: player.connectionId
      } as const;
    }

    // Update last seen timestamp
    await ctx.db.patch(player._id, { lastSeenAt: now() });

    const room = await getRoomByCodeInternal(ctx, code);
    if (room) await touchRoom(ctx, room._id);

    return { status: 'OK' } as const;
  },
});

export const updatePlayerName = mutation({
  args: { code: v.string(), playerId: v.string(), name: v.optional(v.string()), isReady: v.optional(v.boolean()) },
  handler: async (ctx, { code, playerId, name, isReady }) => {
    const player = await ctx.db
      .query("players")
      .withIndex("by_player", (q) => q.eq("playerId", playerId).eq("roomCode", code))
      .unique();
    if (!player) return { code: 'PLAYER_NOT_FOUND' } as const;
    await ctx.db.patch(player._id, {
      name: name ?? player.name,
      isReady: typeof isReady === "boolean" ? isReady : player.isReady,
      lastSeenAt: now(),
    });
    const room = await getRoomByCodeInternal(ctx, code);
    if (room) await touchRoom(ctx, room._id);
    return { code: 'OK' } as const;
  },
});

export const updateSettings = mutation({
  args: { code: v.string(), numberOfRounds: v.number(), roundLength: v.number(), selectedPrompts: v.array(v.string()) },
  handler: async (ctx, { code, numberOfRounds, roundLength, selectedPrompts }) => {
    const room = await getRoomByCodeInternal(ctx, code);
    if (!room) return;
    await ctx.db.patch(room._id, {
      settings: { numberOfRounds, roundLength, selectedPrompts },
      lastActivityAt: now(),
    });
  },
});

export const getRoomByCode = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const room = await getRoomByCodeInternal(ctx, code);
    if (!room) return null;
    const players = await ctx.db
      .query("players")
      .withIndex("by_room", (q) => q.eq("roomCode", code))
      .collect();
    return { room, players };
  },
});

export const getPlayers = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    return await ctx.db
      .query("players")
      .withIndex("by_room", (q) => q.eq("roomCode", code))
      .collect();
  },
});

// Custom prompts (shared across lobby)
export const getCustomPrompts = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const prompts = await ctx.db
      .query("customPrompts")
      .withIndex("by_room", (q) => q.eq("roomCode", code))
      .collect();
    return prompts.map((p) => p.text);
  },
});

export const addCustomPrompt = mutation({
  args: { code: v.string(), text: v.string(), createdBy: v.string() },
  handler: async (ctx, { code, text, createdBy }) => {
    const existing = await ctx.db
      .query("customPrompts")
      .withIndex("by_room_text", (q) => q.eq("roomCode", code).eq("text", text))
      .unique();
    if (existing) return;
    await ctx.db.insert("customPrompts", {
      roomCode: code,
      text,
      createdBy,
      createdAt: Date.now(),
    });
  },
});

export const removeCustomPrompt = mutation({
  args: { code: v.string(), text: v.string() },
  handler: async (ctx, { code, text }) => {
    const existing = await ctx.db
      .query("customPrompts")
      .withIndex("by_room_text", (q) => q.eq("roomCode", code).eq("text", text))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
  },
});

async function generateUniqueCode(ctx: any): Promise<string> {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  while (true) {
    let code = "";
    for (let i = 0; i < 6; i++) {
      code += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    const existing = await getRoomByCodeInternal(ctx, code);
    if (!existing) return code;
  }
}

async function getRoomByCodeInternal(ctx: any, code: string) {
  return await ctx.db.query("rooms").withIndex("by_code", (q: any) => q.eq("code", code)).unique();
}

async function touchRoom(ctx: any, roomId: any) {
  await ctx.db.patch(roomId, { lastActivityAt: now() });
}

/**
 * Deletes a room and all associated data (cascading delete)
 * Called when a room becomes empty or during cleanup
 */
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

  // Finally delete the room itself
  await ctx.db.delete(room._id);

  console.log(`[deleteRoomAndData] Deleted room ${code} and all associated data`);
}

const defaultPrompts = [
  "This song makes me feel like the main character.",
  "The soundtrack to a late-night drive.",
  "This song makes me wanna text my ex (or block them).",
  "A song that defines high school memories.",
  "The perfect song to play while getting ready to go out.",
  "This song could start a mosh pit.",
  "A song that instantly boosts your confidence.",
  "This song would play in the background of my villain arc.",
  "A song that could make me cry on the right day.",
  "The ultimate cookout anthem.",
  "A song that just feels like summertime.",
  "This song is pure nostalgia.",
  "A song that makes you feel unstoppable.",
  "If life had a montage, this song would play in mine.",
  "A song that instantly hypes up the whole room.",
];



