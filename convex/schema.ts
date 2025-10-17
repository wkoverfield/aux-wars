import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  rooms: defineTable({
    code: v.string(),
    phase: v.union(
      v.literal("lobby"),
      v.literal("songSelection"),
      v.literal("rating"),
      v.literal("results"),
      v.literal("gameOver")
    ),
    currentRound: v.number(),
    currentPrompt: v.optional(v.string()),
    currentRatingIndex: v.optional(v.number()),
    hostPlayerId: v.optional(v.id("players")),
    settings: v.object({
      numberOfRounds: v.number(),
      roundLength: v.number(),
      selectedPrompts: v.array(v.string()),
    }),
    createdAt: v.number(),
    lastActivityAt: v.number(),
  }).index("by_code", ["code"]),

  players: defineTable({
    roomCode: v.string(),
    playerId: v.string(),
    connectionId: v.optional(v.string()), // Unique per browser tab/connection
    name: v.string(),
    isHost: v.boolean(),
    isReady: v.boolean(),
    connectedAt: v.optional(v.number()), // When this connection was established
    lastSeenAt: v.number(), // Last heartbeat timestamp
    isActive: v.optional(v.boolean()), // Is this the currently active connection for this playerId?
  })
    .index("by_room", ["roomCode"])
    .index("by_player", ["playerId", "roomCode"]),

  submissions: defineTable({
    roomCode: v.string(),
    round: v.number(),
    playerId: v.string(),
    trackId: v.string(),
    trackDetails: v.object({
      name: v.string(),
      artist: v.string(),
      albumCover: v.string(),
      previewUrl: v.string(),
      snippet: v.optional(
        v.object({ startTime: v.number(), endTime: v.number() })
      ),
    }),
    submittedAt: v.number(),
  })
    .index("by_room_round", ["roomCode", "round"]) 
    .index("by_player_round", ["roomCode", "playerId", "round"]),

  ratings: defineTable({
    roomCode: v.string(),
    round: v.number(),
    songId: v.id("submissions"),
    voterId: v.string(),
    rating: v.number(), // 1-5 or -1 for own song
    submittedAt: v.number(),
  })
    .index("by_song", ["songId"]) 
    .index("by_room_round", ["roomCode", "round"]),

  roundResults: defineTable({
    roomCode: v.string(),
    round: v.number(),
    winnerSongId: v.optional(v.id("submissions")),
    results: v.array(
      v.object({
        songId: v.id("submissions"),
        playerId: v.string(),
        name: v.string(),
        artist: v.string(),
        albumCover: v.string(),
        totalRecords: v.number(),
        isWinner: v.boolean(),
      })
    ),
    calculatedAt: v.number(),
  }).index("by_room_round", ["roomCode", "round"]),

  customPrompts: defineTable({
    roomCode: v.string(),
    text: v.string(),
    createdBy: v.string(),
    createdAt: v.number(),
  })
    .index("by_room", ["roomCode"]) 
    .index("by_room_text", ["roomCode", "text"]),
});


