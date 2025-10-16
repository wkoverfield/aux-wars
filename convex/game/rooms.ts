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
  args: { code: v.string(), playerId: v.string(), name: v.string() },
  handler: async (ctx, { code, playerId, name }) => {
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

    if (!existing) {
      const playerDocId = await ctx.db.insert("players", {
        roomCode: code,
        playerId,
        name,
        isHost: isFirst,
        isReady: false,
        lastSeenAt: now(),
      });
      if (isFirst) {
        await ctx.db.patch(room._id, { hostPlayerId: playerDocId });
      }
    } else {
      // Duplicate playerId attempting to join from another tab/device.
      // Reject and let the client retry with a fresh playerId to ensure uniqueness.
      return { success: false, code: "DUPLICATE_PLAYER", message: "Player ID already in use in this room" } as const;
    }

    await touchRoom(ctx, room._id);
    return { success: true, settings: room.settings, playerId } as const;
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

    // Reassign host if needed
    if (room.hostPlayerId && leaving && room.hostPlayerId.id === leaving._id.id) {
      const remaining = (await ctx.db
        .query("players")
        .withIndex("by_room", (q) => q.eq("roomCode", code))
        .collect()).sort((a, b) => a._creationTime - b._creationTime);
      if (remaining[0]) {
        await ctx.db.patch(room._id, { hostPlayerId: remaining[0]._id });
        await ctx.db.patch(remaining[0]._id, { isHost: true });
      }
    }
    await touchRoom(ctx, room._id);
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



