import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { internal } from "../_generated/api";

function now() {
  return Date.now();
}

// Player caps: free rooms are capped at 8; rooms hosted with the pro pack get a
// much higher cap (effectively unlimited for a party, while protecting the backend).
const FREE_PLAYER_CAP = 8;
const PRO_PLAYER_CAP = 50;

export const hostGame = mutation({
  args: { proToken: v.optional(v.string()) },
  handler: async (ctx, { proToken }) => {
    const code = await generateUniqueCode(ctx);

    // Pro pack: validate the buyer's token and flag the room (ad-free + raised cap).
    let hostPro = false;
    if (proToken) {
      const entitlement = await ctx.db
        .query("entitlements")
        .withIndex("by_token", (q) => q.eq("proToken", proToken))
        .first();
      hostPro = Boolean(entitlement?.active);
    }

    await ctx.db.insert("rooms", {
      code,
      phase: "lobby",
      currentRound: 1,
      currentPrompt: undefined,
      hostPlayerId: undefined,
      settings: {
        numberOfRounds: 3,
        roundLength: 60, // Song selection time limit (seconds), 0 = no limit
        snippetDuration: 30, // Audio playback duration, 0 = full song
        selectedPrompts: defaultPrompts,
        enablePromptVoting: true, // Let players vote to skip prompts
        anonymousMode: false, // Hide submitter names during rating
        hostPro, // Pro pack: ad-free room + raised player cap
      },
      createdAt: now(),
      lastActivityAt: now(),
    });

    // Track game creation
    await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
      eventType: "game_created",
      metadata: { roomCode: code },
    });

    return { code };
  },
});

export const joinGame = mutation({
  args: { code: v.string(), playerId: v.string(), connectionId: v.string(), name: v.string() },
  handler: async (ctx, { code, playerId, connectionId, name }) => {
    // Validate player name
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName.length < 1 || trimmedName.length > 50) {
      return { success: false, message: "Name must be between 1 and 50 characters" };
    }

    const room = await getRoomByCodeInternal(ctx, code);
    if (!room) return { success: false, message: "Game code not found" };

    const players = await ctx.db
      .query("players")
      .withIndex("by_room", (q) => q.eq("roomCode", code))
      .collect();

    const isFirst = players.length === 0;

    // Enforce player cap (unless player is rejoining). Pro rooms get a raised cap.
    const existing = await ctx.db
      .query("players")
      .withIndex("by_player", (q) => q.eq("playerId", playerId).eq("roomCode", code))
      .unique();

    const playerCap = room.settings?.hostPro ? PRO_PLAYER_CAP : FREE_PLAYER_CAP;
    if (!existing && players.length >= playerCap) {
      return { success: false, message: `Room is full (max ${playerCap} players)` };
    }

    if (existing) {
      // CONNECTION TAKEOVER: This player is rejoining from another tab/device
      // Deactivate the old connection and activate this new one
      const oldConnectionId = existing.connectionId;

      await ctx.db.patch(existing._id, {
        connectionId,           // Update to new connection ID
        name: trimmedName,      // Update name in case it changed
        connectedAt: now(),     // Record when this connection was established
        lastSeenAt: now(),      // Update last seen
        isActive: true,         // Mark this connection as active
        // Clear rate limit timestamps to prevent bypass via refresh
        lastSubmissionAttempt: undefined,
        lastRatingAttempt: undefined,
        lastVoteSkipAttempt: undefined,
      });

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
        name: trimmedName,
        isHost: isFirst,
        isReady: false,
        connectedAt: now(),
        lastSeenAt: now(),
        isActive: true,
      });

      if (isFirst) {
        await ctx.db.patch(room._id, { hostPlayerId: playerDocId });
      }

      // Track player joined
      await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
        eventType: "player_joined",
        metadata: { roomCode: code, playerId },
      });

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
    if (leaving) {
      await ctx.db.delete(leaving._id);

      // Track player left
      await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
        eventType: "player_left",
        metadata: { roomCode: code, playerId },
      });
    }

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
      }
    }

    await touchRoom(ctx, room._id);
    return { roomDeleted: false } as const;
  },
});

export const kickPlayer = mutation({
  args: {
    code: v.string(),
    hostPlayerId: v.string(),
    targetPlayerId: v.string()
  },
  handler: async (ctx, { code, hostPlayerId, targetPlayerId }) => {
    const room = await getRoomByCodeInternal(ctx, code);
    if (!room) {
      return { success: false, message: "Room not found" };
    }

    // Verify caller is the host
    const host = await getPlayer(ctx, code, hostPlayerId);
    if (!host || !host.isHost) {
      return { success: false, message: "Only the host can kick players" };
    }

    // Prevent host from kicking themselves
    if (hostPlayerId === targetPlayerId) {
      return { success: false, message: "You cannot kick yourself" };
    }

    // Verify target player exists
    const target = await getPlayer(ctx, code, targetPlayerId);
    if (!target) {
      return { success: false, message: "Player not found" };
    }

    // Remove the player
    await ctx.db.delete(target._id);

    // Check remaining players
    const remaining = await ctx.db
      .query("players")
      .withIndex("by_room", (q) => q.eq("roomCode", code))
      .collect();

    // If room is now empty, delete it
    if (remaining.length === 0) {
      console.log(`[kickPlayer] Room ${code} is now empty - deleting`);
      await deleteRoomAndData(ctx, room);
      return { success: true, roomDeleted: true };
    }

    await touchRoom(ctx, room._id);
    return { success: true, roomDeleted: false };
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
  args: { code: v.string(), playerId: v.string(), connectionId: v.string(), name: v.optional(v.string()), isReady: v.optional(v.boolean()) },
  handler: async (ctx, { code, playerId, connectionId, name, isReady }) => {
    // Validate player name if provided
    if (name !== undefined) {
      const trimmedName = name.trim();
      if (!trimmedName || trimmedName.length < 1 || trimmedName.length > 50) {
        return { code: 'INVALID_NAME', message: 'Name must be between 1 and 50 characters' } as const;
      }
    }

    // Validate connection (prevents stale tabs from updating after takeover)
    const player = await validateConnection(ctx, code, playerId, connectionId);
    if (!player) {
      return { code: 'CONNECTION_TAKEN_OVER' } as const;
    }

    await ctx.db.patch(player._id, {
      name: name ? name.trim() : player.name,
      isReady: typeof isReady === "boolean" ? isReady : player.isReady,
      lastSeenAt: now(),
    });
    const room = await getRoomByCodeInternal(ctx, code);
    if (room) await touchRoom(ctx, room._id);
    return { code: 'OK' } as const;
  },
});

export const updateSettings = mutation({
  args: {
    code: v.string(),
    playerId: v.string(),
    numberOfRounds: v.number(),
    roundLength: v.number(), // 0 = no limit, else seconds for song selection
    snippetDuration: v.number(), // 0 = full song, else seconds for playback
    selectedPrompts: v.array(v.string()),
    enablePromptVoting: v.optional(v.boolean()), // default true - let players vote to skip prompts
    anonymousMode: v.optional(v.boolean()), // default false - hide submitter names during rating
  },
  handler: async (ctx, { code, playerId, numberOfRounds, roundLength, snippetDuration, selectedPrompts, enablePromptVoting, anonymousMode }) => {
    // Validate settings
    if (numberOfRounds < 1 || numberOfRounds > 10) {
      throw new Error("Number of rounds must be between 1 and 10");
    }
    // roundLength: 0 = no limit, or 15-300 seconds
    if (roundLength !== 0 && (roundLength < 15 || roundLength > 300)) {
      throw new Error("Round length must be 0 (no limit) or between 15-300 seconds");
    }
    // snippetDuration: 0 = full song, or 15/30/45/60/90 seconds
    const validSnippetDurations = [0, 15, 30, 45, 60, 90];
    if (!validSnippetDurations.includes(snippetDuration)) {
      throw new Error("Invalid snippet duration");
    }
    if (selectedPrompts.length < 1 || selectedPrompts.length > 50) {
      throw new Error("Must have between 1 and 50 prompts selected");
    }

    const room = await getRoomByCodeInternal(ctx, code);
    if (!room) {
      throw new Error("Room not found");
    }

    // Only host can change settings
    const player = await getPlayer(ctx, code, playerId);
    if (!player) {
      throw new Error("Player not found");
    }
    if (!player.isHost) {
      throw new Error("Only the host can update settings");
    }

    await ctx.db.patch(room._id, {
      settings: {
        numberOfRounds,
        roundLength,
        snippetDuration,
        selectedPrompts,
        enablePromptVoting: enablePromptVoting ?? true,
        anonymousMode: anonymousMode ?? false,
      },
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
    // Validate custom prompt length
    const trimmedText = text.trim();
    if (!trimmedText || trimmedText.length < 1 || trimmedText.length > 200) {
      throw new Error("Prompt must be between 1 and 200 characters");
    }

    // Custom prompt pool cap. Round count stays capped separately, so a larger
    // pool only improves prompt variety across games.
    const allPrompts = await ctx.db
      .query("customPrompts")
      .withIndex("by_room", (q) => q.eq("roomCode", code))
      .collect();
    if (allPrompts.length >= 50) {
      throw new Error("Maximum custom prompts reached (50)");
    }

    const playerPrompts = allPrompts.filter(p => p.createdBy === createdBy);

    // Rate limiting: 2 second cooldown per player
    const recentPrompt = playerPrompts.find(p => Date.now() - p.createdAt < 2000);
    if (recentPrompt) {
      throw new Error("Please wait before adding another prompt");
    }

    // Check for duplicate
    const existing = await ctx.db
      .query("customPrompts")
      .withIndex("by_room_text", (q) => q.eq("roomCode", code).eq("text", trimmedText))
      .unique();
    if (existing) {
      throw new Error("This prompt already exists");
    }

    await ctx.db.insert("customPrompts", {
      roomCode: code,
      text: trimmedText,
      createdBy,
      createdAt: Date.now(),
    });
  },
});

export const addCustomPrompts = mutation({
  args: { code: v.string(), prompts: v.array(v.string()), createdBy: v.string() },
  handler: async (ctx, { code, prompts, createdBy }) => {
    const allPrompts = await ctx.db
      .query("customPrompts")
      .withIndex("by_room", (q) => q.eq("roomCode", code))
      .collect();
    const existingTexts = new Set(allPrompts.map((p) => p.text));
    const nextPrompts: string[] = [];
    let skipped = 0;

    for (const prompt of prompts) {
      const text = prompt.trim();
      if (!text || text.length > 200) {
        skipped += 1;
        continue;
      }
      if (existingTexts.has(text) || nextPrompts.includes(text)) {
        skipped += 1;
        continue;
      }
      nextPrompts.push(text);
    }

    const remainingSlots = Math.max(0, 50 - allPrompts.length);
    const promptsToAdd = nextPrompts.slice(0, remainingSlots);
    const maxedOut = nextPrompts.length > promptsToAdd.length || remainingSlots === 0;

    for (const text of promptsToAdd) {
      await ctx.db.insert("customPrompts", {
        roomCode: code,
        text,
        createdBy,
        createdAt: Date.now(),
      });
    }

    return {
      added: promptsToAdd.length,
      skipped: skipped + Math.max(0, nextPrompts.length - promptsToAdd.length),
      maxedOut,
    };
  },
});

export const removeCustomPrompt = mutation({
  args: { code: v.string(), text: v.string(), playerId: v.string() },
  handler: async (ctx, { code, text, playerId }) => {
    // Only host can remove custom prompts
    const player = await getPlayer(ctx, code, playerId);
    if (!player) {
      throw new Error("Player not found");
    }
    if (!player.isHost) {
      throw new Error("Only the host can remove prompts");
    }

    const existing = await ctx.db
      .query("customPrompts")
      .withIndex("by_room_text", (q) => q.eq("roomCode", code).eq("text", text))
      .unique();
    if (existing) {
      await ctx.db.delete(existing._id);
    }
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

async function getPlayer(ctx: any, code: string, playerId: string) {
  return await ctx.db
    .query("players")
    .withIndex("by_player", (q: any) => q.eq("playerId", playerId).eq("roomCode", code))
    .unique();
}

async function validateConnection(ctx: any, code: string, playerId: string, connectionId: string) {
  const player = await getPlayer(ctx, code, playerId);
  if (!player) {
    console.log(`[validateConnection] Player ${playerId} not found in room ${code}`);
    return null;
  }
  if (player.connectionId !== connectionId) {
    console.log(`[validateConnection] Connection mismatch for ${playerId}. Expected: ${player.connectionId}, Got: ${connectionId}`);
    return null;
  }
  return player;
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

