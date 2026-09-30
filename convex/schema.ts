import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Fields of one dailyMetrics row (everything except retention, which later
// rollups patch in). Exported so the rollup writer validates the same shape.
export const dailyMetricsFields = {
  date: v.string(), // UTC "YYYY-MM-DD"
  computedAt: v.number(),
  gamesCreated: v.number(),
  gamesStarted: v.number(),
  gamesCompleted: v.number(),
  gamesAbandoned: v.number(),
  abandonedByPhase: v.record(v.string(), v.number()),
  completionRate: v.union(v.number(), v.null()), // completed / started, 0-1
  playerJoins: v.number(),
  uniquePlayers: v.number(), // distinct visitorId (playerId for legacy joins)
  joinsWithVisitorId: v.number(),
  playersInStartedGames: v.number(), // distinct players who joined a room that started
  playersInCompletedGames: v.number(), // distinct players who joined a room that completed
  playerSeatsCompleted: v.number(), // sum of playerCount over completed games
  avgPlayersPerGame: v.union(v.number(), v.null()), // over started games
  p90PlayersPerGame: v.union(v.number(), v.null()),
  maxPlayersPerGame: v.union(v.number(), v.null()),
  songsSubmitted: v.number(),
  ratingsSubmitted: v.number(),
  pageviews: v.number(), // site-wide, from pageviewCounters
  uniqueVisitors: v.number(), // site-wide, from pageviewCounters
  newVisitors: v.union(v.number(), v.null()),
  returningVisitors: v.union(v.number(), v.null()),
  newVisitorsPlayed: v.union(v.number(), v.null()), // new visitors who played the same day
  newPlayers: v.union(v.number(), v.null()),
  peakPlayersOnline: v.union(v.number(), v.null()),
  peakPlayersInGame: v.union(v.number(), v.null()),
  peakHourUTC: v.union(v.number(), v.null()),
  proPurchases: v.number(),
  searchNoResults: v.number(),
  topNoResultSearches: v.array(v.object({ query: v.string(), count: v.number() })),
  // Client searches that failed (timeout, network, HTTP error, bad payload),
  // distinct from searchNoResults. Optional: rows rolled up before
  // search_failed existed do not have them.
  searchFailed: v.optional(v.number()),
  searchFailedByReason: v.optional(v.record(v.string(), v.number())),
  // That day's per-UTC-hour concurrency maxes (hours with no players omitted).
  hourlyPeaks: v.array(
    v.object({ hourUTC: v.number(), playersOnline: v.number(), playersInGame: v.number() })
  ),
};

const retentionPoint = v.object({ cohort: v.number(), returned: v.number() });
export const dailyRetentionValidator = v.object({
  d1: v.optional(retentionPoint),
  d7: v.optional(retentionPoint),
  d30: v.optional(retentionPoint),
});

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
    locked: v.optional(v.boolean()), // host sealed the room — block new joins (streamer-safe)
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
    rematchStartingAt: v.optional(v.number()), // Timestamp the "Play Again" countdown fires (gameOver → fresh game)
    createdAt: v.number(),
    lastActivityAt: v.number(),
  })
    .index("by_code", ["code"])
    .index("by_lastActivityAt", ["lastActivityAt"]),

  players: defineTable({
    roomCode: v.string(),
    playerId: v.string(),
    connectionId: v.optional(v.string()), // Unique per browser tab/connection
    name: v.string(),
    isHost: v.boolean(),
    isReady: v.boolean(),
    connectedAt: v.optional(v.number()), // When this connection was established
    // DEPRECATED: legacy heartbeat timestamp. No longer written; connectedness
    // now lives in the @convex-dev/presence component (see convex/presence.ts).
    // Optional so existing rows stay valid; safe to drop once old rows age out.
    lastSeenAt: v.optional(v.number()),
    isActive: v.optional(v.boolean()), // Is this the currently active connection for this playerId?
    submittedRounds: v.optional(v.array(v.number())), // Tracks which rounds this player has submitted for (prevents race conditions)
    // DEPRECATED: rate-limit stamps. No longer written; they live in
    // playerRateLimits so a vote does not rewrite a document every room
    // query reads. Optional so existing rows stay valid.
    lastSubmissionAttempt: v.optional(v.number()),
    lastRatingAttempt: v.optional(v.number()),
    lastVoteSkipAttempt: v.optional(v.number()),
  })
    .index("by_room", ["roomCode"])
    .index("by_player", ["playerId", "roomCode"]),

  // Per-player rate-limit stamps, one row per (player, room). Kept off the
  // players table: every room query collects the room's players, so a stamp
  // written there on each vote re-ran every subscribed query for every player
  // in the room. Deleted with the room.
  playerRateLimits: defineTable({
    playerId: v.string(),
    roomCode: v.string(),
    lastSubmissionAttempt: v.optional(v.number()),
    lastRatingAttempt: v.optional(v.number()),
    lastVoteSkipAttempt: v.optional(v.number()),
  })
    .index("by_player", ["playerId", "roomCode"])
    .index("by_room", ["roomCode"]),

  submissions: defineTable({
    roomCode: v.string(),
    round: v.number(),
    playerId: v.string(),
    trackId: v.string(),
    trackDetails: v.object({
      name: v.string(),
      artist: v.string(),
      albumCover: v.string(),
      // A track is EITHER a YouTube video (videoId, full song) OR an
      // iTunes/Deezer preview (previewUrl, 30s). Both optional so either
      // source validates; existing rows all have previewUrl.
      previewUrl: v.optional(v.string()),
      videoId: v.optional(v.string()),
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
    prompt: v.optional(v.string()), // the prompt this round was played for (powers the recap setlist)
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
    mergedInto: v.optional(v.id("feedback")),
    mergedAt: v.optional(v.string()),
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

  // Homepage counters, one row, rewritten by a cron once a minute from
  // analyticsAggregates. The homepage subscribes to this row instead of the
  // aggregates, which change on every tracked event.
  liveStats: defineTable({
    gameStarted: v.number(),
    playerJoined: v.number(),
    ratingSubmitted: v.number(),
    updatedAt: v.number(),
  }),

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
  // Sharded: a key's value is the SUM of its rows. Each write lands on one of
  // PAGEVIEW_SHARDS rows chosen at random, so concurrent pageviews do not all
  // conflict on one document. Rows without `shard` predate sharding and count
  // as shard 0 (folded by siteStats:migratePageviewShards). Read through
  // readCounter / readAllCounters in siteStats.ts, never with .first().
  pageviewCounters: defineTable({
    key: v.string(),
    count: v.number(),
    shard: v.optional(v.number()),
  })
    .index("by_key", ["key"])
    .index("by_key_and_shard", ["key", "shard"]),

  // Per-day unique-visitor dedup rows (pruned > 120 days by cron).
  pageviewVisits: defineTable({
    date: v.string(),
    visitorId: v.string(),
  }).index("by_date_and_visitor", ["date", "visitorId"]),

  // --- Durable metric snapshots ---
  // One row per UTC day banking the all-time cumulative counters as they stood
  // that day (analyticsAggregates action counts + permanent pageview totals).
  // Raw analyticsEvents prune after 90 days, but diffing two snapshots recovers
  // any window (7d/30d/yearly) forever. `metrics` is an open key->count map so
  // new counters (e.g. new event types) are captured without a schema change.
  metricSnapshots: defineTable({
    date: v.string(), // UTC "YYYY-MM-DD"
    capturedAt: v.number(),
    metrics: v.record(v.string(), v.number()),
  }).index("by_date", ["date"]),

  // --- Concurrency (see convex/concurrency.ts) ---
  // Written by a 60s internal cron. Never read by homepage or gameplay queries.
  // kind "latest": a single row (hourStart 0) with the most recent sample,
  // rewritten every run; updatedAt is when it was taken.
  // kind "hour": one row per UTC hour holding that hour's max of each value,
  // written only when a sample beats it.
  // kind "allTime": a single row (hourStart 0) holding the all-time record and
  // when each value was set, written only when a sample beats it.
  concurrencyStats: defineTable({
    kind: v.union(v.literal("hour"), v.literal("allTime"), v.literal("latest")),
    hourStart: v.number(), // UTC ms at the start of the hour; 0 for allTime and latest
    date: v.optional(v.string()), // hour rows: UTC "YYYY-MM-DD"
    hourUTC: v.optional(v.number()), // hour rows: 0-23
    playersOnline: v.number(),
    playersInGame: v.number(),
    activeRooms: v.number(),
    activeGames: v.number(),
    playersOnlineAt: v.optional(v.number()), // allTime row: when the online record was set
    playersInGameAt: v.optional(v.number()), // allTime row: when the in-game record was set
    updatedAt: v.number(),
  })
    .index("by_kind_and_hourStart", ["kind", "hourStart"])
    .index("by_kind_and_date", ["kind", "date"]),

  // --- Permanent daily rollups (see convex/dailyMetrics.ts) ---
  // One row per UTC date, never pruned. Rebuilt idempotently from raw
  // analyticsEvents (90-day window), pageview counters, visitorFirstSeen and
  // concurrencyStats. Nullable fields are null when the source data did not
  // exist for that date (never zero-filled).
  dailyMetrics: defineTable({
    ...dailyMetricsFields,
    // Retention of this date's new-visitor cohort, filled in by the rollups of
    // date+1, date+7 and date+30: visitors seen again on exactly that day.
    retention: v.optional(dailyRetentionValidator),
  }).index("by_date", ["date"]),

  // --- Retention identity ---
  // One row per opaque client visitor id, never pruned. firstSeenDate comes
  // from the first pageview (or the first join when no pageview landed);
  // firstPlayedDate from the first join that carried the visitor id.
  visitorFirstSeen: defineTable({
    visitorId: v.string(),
    firstSeenDate: v.string(), // UTC "YYYY-MM-DD"
    firstPlayedDate: v.optional(v.string()), // UTC "YYYY-MM-DD"
  })
    .index("by_visitor", ["visitorId"])
    .index("by_firstSeenDate", ["firstSeenDate"])
    .index("by_firstPlayedDate", ["firstPlayedDate"]),
});

