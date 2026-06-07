import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  rooms: defineTable({
    code: v.string(),
    phase: v.union(
      v.literal("lobby"),
      v.literal("promptVoting"), // NEW: Brief phase to optionally skip prompt
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
      snippetDuration: v.number(), // 0 = full song, else seconds for playback
      selectedPrompts: v.array(v.string()),
      enablePromptVoting: v.optional(v.boolean()), // default true - let players vote to skip prompts
      anonymousMode: v.optional(v.boolean()), // default false - hide submitter names during rating
      hostPro: v.optional(v.boolean()), // host purchased the pro pack: ad-free room + raised player cap
    }),
    usedPrompts: v.optional(v.array(v.string())), // Tracks prompts used this game to avoid repeats
    selectionStartedAt: v.optional(v.number()), // Timestamp when song selection phase started
    promptVotingStartedAt: v.optional(v.number()), // Timestamp when prompt voting started
    skipVotes: v.optional(v.array(v.string())), // Player IDs who voted to skip current prompt
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
    submittedRounds: v.optional(v.array(v.number())), // Tracks which rounds this player has submitted for (prevents race conditions)
    lastSubmissionAttempt: v.optional(v.number()), // Rate limiting: timestamp of last submission attempt
    lastRatingAttempt: v.optional(v.number()), // Rate limiting: timestamp of last rating attempt
    lastVoteSkipAttempt: v.optional(v.number()), // Rate limiting: timestamp of last vote skip attempt
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

  feedback: defineTable({
    type: v.string(), // "feature" | "bug" | "improvement" | "other"
    title: v.string(),
    description: v.string(),
    status: v.string(), // "pending" | "planned" | "completed" | "declined"
    upvotes: v.number(),
    upvoterIds: v.array(v.string()), // Track who voted (prevent double voting)
    authorName: v.optional(v.string()),
    createdAt: v.string(),
  })
    .index("by_upvotes", ["upvotes"])
    .index("by_status", ["status"]),

  analyticsEvents: defineTable({
    eventType: v.string(),
    timestamp: v.number(),
    // Loosely typed: event metadata varies by app version (roomCode, playerId,
    // playerCount, roundNumber, totalRounds, value, label, phase, ...), so accept
    // any object shape rather than fail schema validation on legacy data. Current
    // code still writes structured metadata.
    metadata: v.optional(v.any()),
  })
    .index("by_type", ["eventType"])
    .index("by_timestamp", ["timestamp"])
    .index("by_type_and_timestamp", ["eventType", "timestamp"]),

  // Aggregated analytics counts (avoids scanning all events)
  analyticsAggregates: defineTable({
    eventType: v.string(),
    count: v.number(),
    lastUpdated: v.number(),
  }).index("by_type", ["eventType"]),

  // Pro pack purchases. A proToken is issued after a verified Stripe payment and
  // stored on the buyer's device; hosting with it flags the room as hostPro
  // (ad-free + raised player cap).
  entitlements: defineTable({
    proToken: v.string(),
    stripeSessionId: v.string(),
    email: v.optional(v.string()),
    active: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_token", ["proToken"])
    .index("by_session", ["stripeSessionId"])
    .index("by_email", ["email"]),

  // Update notes shown in the homepage News section.
  news: defineTable({
    title: v.string(),
    body: v.string(),
    publishedAt: v.number(),
    published: v.boolean(),
  }).index("by_published", ["published", "publishedAt"]),

  // --- Site stats (pageview analytics) ---
  // Cumulative counters keyed by "total" | "path:<p>" | "day:<YYYY-MM-DD>" | "uvday:<YYYY-MM-DD>".
  pageviewCounters: defineTable({
    key: v.string(),
    count: v.number(),
  }).index("by_key", ["key"]),

  // Per-day unique-visitor dedup rows (pruned > 120 days by cron).
  pageviewVisits: defineTable({
    date: v.string(),
    visitorId: v.string(),
  }).index("by_date_and_visitor", ["date", "visitorId"]),
});


