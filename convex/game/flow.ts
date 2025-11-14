import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation, mutation, query } from "../_generated/server";

function now() { return Date.now(); }

export const startGame = mutation({
  args: { code: v.string(), playerId: v.string() },
  handler: async (ctx, { code, playerId }) => {
    const room = await getRoom(ctx, code);
    if (!room) return;
    const players = await getPlayers(ctx, code);
    const host = room.hostPlayerId ? await ctx.db.get(room.hostPlayerId) : null;
    if (!host || host.playerId !== playerId) return; // only host
    if (players.length < 3) return; // min players
    const allReady = players.every((p) => p.isReady);
    if (!allReady) return;

    const chosenPrompt = pickPrompt(room.settings.selectedPrompts);
    await ctx.db.patch(room._id, {
      phase: "songSelection",
      currentRound: 1,
      currentPrompt: chosenPrompt,
      lastActivityAt: now(),
    });
  },
});

export const submitSong = mutation({
  args: {
    code: v.string(),
    playerId: v.string(),
    connectionId: v.string(),
    trackId: v.string(),
    trackDetails: v.object({
      name: v.string(),
      artist: v.string(),
      albumCover: v.string(),
      previewUrl: v.string(),
      snippet: v.optional(v.object({ startTime: v.number(), endTime: v.number() })),
    }),
  },
  handler: async (ctx, { code, playerId, connectionId, trackId, trackDetails }) => {
    const room = await getRoom(ctx, code);

    if (!room || room.phase !== "songSelection") {
      return;
    }

    // Validate connection (prevents stale tabs from submitting after takeover)
    const player = await validateConnection(ctx, code, playerId, connectionId);
    if (!player) {
      console.log(`[submitSong] Rejecting submission: connection validation failed`);
      return;
    }

    // Rate limiting: Prevent rapid submission attempts (max 1 per second)
    const lastAttempt = player.lastSubmissionAttempt;
    if (lastAttempt && now() - lastAttempt < 1000) {
      console.log(`[submitSong] Rate limit: Player ${playerId} attempting too quickly`);
      return;
    }

    // Update last attempt timestamp
    await ctx.db.patch(player._id, {
      lastSubmissionAttempt: now()
    });

    const players = await getPlayers(ctx, code);

    // Prevent duplicate submission by the same player in the same round
    // Use player's submittedRounds field for atomic check
    if (player.submittedRounds?.includes(room.currentRound)) {
      console.log(`[submitSong] Player ${playerId} already submitted for round ${room.currentRound}, skipping insert`);
      return; // Already submitted, exit early
    }

    // Mark this round as submitted BEFORE inserting (prevents race condition)
    await ctx.db.patch(player._id, {
      submittedRounds: [...(player.submittedRounds || []), room.currentRound]
    });

    // Now insert the submission
    await ctx.db.insert("submissions", {
      roomCode: code,
      round: room.currentRound,
      playerId,
      trackId,
      trackDetails,
      submittedAt: now(),
    });
    
    const subs = await ctx.db
      .query("submissions")
      .withIndex("by_room_round", (q) => q.eq("roomCode", code).eq("round", room.currentRound))
      .collect();

    // Robust unique-submitter check
    const submittedPlayerIds = new Set(subs.map((s) => s.playerId));
    const allSubmitted = players.every((p) => submittedPlayerIds.has(p.playerId));

    if (allSubmitted) {
      // Use scheduler to avoid direct mutation-to-mutation call
      await ctx.scheduler.runAfter(0, internal.game.flow.startRatingPhaseInternal, { code });
    }
  },
});

export const submitRating = mutation({
  args: { code: v.string(), playerId: v.string(), connectionId: v.string(), songId: v.id("submissions"), rating: v.number() },
  handler: async (ctx, { code, playerId, connectionId, songId, rating }) => {
    const room = await getRoom(ctx, code);
    if (!room || room.phase !== "rating") return;

    // Validate connection (prevents stale tabs from rating after takeover)
    const player = await validateConnection(ctx, code, playerId, connectionId);
    if (!player) {
      console.log(`[submitRating] Rejecting rating: connection validation failed`);
      return;
    }

    // Rate limiting: Prevent rapid rating attempts (max 1 per second)
    const lastAttempt = (player as any).lastRatingAttempt;
    if (lastAttempt && now() - lastAttempt < 1000) {
      console.log(`[submitRating] Rate limit: Player ${playerId} attempting too quickly`);
      return;
    }

    // Update last attempt timestamp
    await ctx.db.patch(player._id, {
      lastRatingAttempt: now()
    } as any);

    // Check if player already rated this song (prevents duplicate ratings)
    const existingRatings = await ctx.db
      .query("ratings")
      .withIndex("by_song", (q) => q.eq("songId", songId))
      .collect();

    const hasAlreadyVoted = existingRatings.some((r) => r.voterId === playerId);
    if (hasAlreadyVoted) {
      console.log(`[submitRating] Player ${playerId} already rated song ${songId}`);
      return;
    }

    await ctx.db.insert("ratings", {
      roomCode: code,
      round: room.currentRound,
      songId,
      voterId: playerId,
      rating,
      submittedAt: now(),
    });
    // After each rating, check if all eligible voters have voted and advance
    // Use scheduler to avoid direct mutation-to-mutation call
    await ctx.scheduler.runAfter(0, internal.game.flow.maybeAdvanceOnAllVotes, { code });
  },
});

export const nextRound = mutation({
  args: { code: v.string(), playerId: v.string() },
  handler: async (ctx, { code, playerId }) => {
    const room = await getRoom(ctx, code);
    if (!room) return;
    const host = room.hostPlayerId ? await ctx.db.get(room.hostPlayerId) : null;
    if (!host || host.playerId !== playerId) return;

    const isLastRound = room.currentRound >= room.settings.numberOfRounds;
    if (isLastRound) {
      await ctx.db.patch(room._id, { phase: "gameOver", lastActivityAt: now() });
      return;
    }

    const chosenPrompt = pickPrompt(room.settings.selectedPrompts);
    await ctx.db.patch(room._id, {
      currentRound: room.currentRound + 1,
      currentPrompt: chosenPrompt,
      phase: "songSelection",
      lastActivityAt: now(),
    });

    // Clean submittedRounds for all players in new round
    const players = await getPlayers(ctx, code);
    await Promise.all(
      players.map((p) => ctx.db.patch(p._id, { submittedRounds: [] }))
    );
  },
});

export const returnToLobby = mutation({
  args: { code: v.string(), playerId: v.string() },
  handler: async (ctx, { code, playerId }) => {
    const room = await getRoom(ctx, code);
    if (!room) return;
    const host = room.hostPlayerId ? await ctx.db.get(room.hostPlayerId) : null;
    if (!host || host.playerId !== playerId) return;

    // Clean up all game data from previous game
    const submissions = await ctx.db
      .query("submissions")
      .withIndex("by_room_round", (q) => q.eq("roomCode", code))
      .collect();
    await Promise.all(submissions.map(s => ctx.db.delete(s._id)));

    const ratings = await ctx.db
      .query("ratings")
      .withIndex("by_room_round", (q) => q.eq("roomCode", code))
      .collect();
    await Promise.all(ratings.map(r => ctx.db.delete(r._id)));

    const roundResults = await ctx.db
      .query("roundResults")
      .withIndex("by_room_round", (q) => q.eq("roomCode", code))
      .collect();
    await Promise.all(roundResults.map(rr => ctx.db.delete(rr._id)));

    await ctx.db.patch(room._id, {
      phase: "lobby",
      currentRound: 1,
      currentPrompt: undefined,
      lastActivityAt: now(),
    });

    const players = await getPlayers(ctx, code);
    await Promise.all(players.map((p) => ctx.db.patch(p._id, { isReady: false, submittedRounds: [] })));
  },
});

export const getSubmissionStatus = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const room = await getRoom(ctx, code);
    if (!room) return { submitted: 0, total: 0 };
    const players = await getPlayers(ctx, code);
    const subs = await ctx.db
      .query("submissions")
      .withIndex("by_room_round", (q) => q.eq("roomCode", code).eq("round", room.currentRound))
      .collect();
    const uniqueSubmitters = new Set(subs.map((s) => s.playerId)).size;
    return { submitted: uniqueSubmitters, total: players.length };
  },
});

export const getMySubmission = query({
  args: { code: v.string(), playerId: v.string(), round: v.number() },
  handler: async (ctx, { code, playerId, round }) => {
    return await ctx.db
      .query("submissions")
      .withIndex("by_player_round", (q) =>
        q.eq("roomCode", code).eq("playerId", playerId).eq("round", round)
      )
      .unique();
  },
});

export const getRatingStatus = query({
  args: { code: v.string(), ratingIndex: v.number() },
  handler: async (ctx, { code }) => {
    const room = await getRoom(ctx, code);
    if (!room) return { submitted: 0, total: 0 };
    const players = await getPlayers(ctx, code);
    const subs = await ctx.db
      .query("submissions")
      .withIndex("by_room_round", (q) => q.eq("roomCode", code).eq("round", room.currentRound))
      .collect();
    const current = subs[room.currentRatingIndex ?? 0];
    if (!current) return { submitted: 0, total: players.length };
    const ratings = await ctx.db
      .query("ratings")
      .withIndex("by_song", (q) => q.eq("songId", current._id))
      .collect();
    return { submitted: ratings.length, total: players.length };
  },
});

export const getCurrentRatingSong = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const room = await getRoom(ctx, code);
    if (!room || room.phase !== "rating") return null;
    const subs = await ctx.db
      .query("submissions")
      .withIndex("by_room_round", (q) => q.eq("roomCode", code).eq("round", room.currentRound))
      .collect();
    const idx = room.currentRatingIndex ?? 0;
    const submission = subs[idx];
    if (!submission) return null;

    // Fetch player information
    const player = await ctx.db
      .query("players")
      .withIndex("by_player", (q) => q.eq("playerId", submission.playerId).eq("roomCode", code))
      .unique();

    // Transform to match RatingScreen expectations
    return {
      songId: submission._id,
      name: submission.trackDetails.name,
      artist: submission.trackDetails.artist,
      albumCover: submission.trackDetails.albumCover,
      previewUrl: submission.trackDetails.previewUrl,
      snippet: submission.trackDetails.snippet,
      player: {
        id: submission.playerId,
        name: player?.name || "Unknown Player"
      }
    };
  },
});

export const getRoundResults = query({
  args: { code: v.string(), round: v.number() },
  handler: async (ctx, { code, round }) => {
    const rr = await ctx.db
      .query("roundResults")
      .withIndex("by_room_round", (q) => q.eq("roomCode", code).eq("round", round))
      .unique();

    if (!rr) return null;

    // Enrich results with player names and transform to expected format
    const songsWithPlayers = await Promise.all(
      rr.results.map(async (result) => {
        // Look up player to get their name
        const player = await ctx.db
          .query("players")
          .withIndex("by_player", (q) => q.eq("playerId", result.playerId).eq("roomCode", code))
          .unique();

        return {
          ...result,
          player: {
            id: result.playerId,
            name: player?.name || "Unknown Player"
          }
        };
      })
    );

    // Transform to match client expectations (songs instead of results)
    return {
      ...rr,
      songs: songsWithPlayers,
      winnerSongId: rr.winnerSongId,
      round: rr.round,
      roomCode: rr.roomCode
    };
  },
});

export const getAllRoundResults = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const allResults = await ctx.db
      .query("roundResults")
      .withIndex("by_room_round", (q) => q.eq("roomCode", code))
      .collect();

    // Batch player lookup: collect all unique playerIds first
    const allPlayerIds = new Set<string>();
    allResults.forEach(rr => {
      rr.results.forEach(result => {
        allPlayerIds.add(result.playerId);
      });
    });

    // Single batch query for all players
    const allPlayers = await ctx.db
      .query("players")
      .withIndex("by_room", (q) => q.eq("roomCode", code))
      .collect();

    // Create Map for O(1) lookup
    const playerMap = new Map(
      allPlayers.map(p => [p.playerId, p])
    );

    // Enrich each round's results with player names and transform to expected format
    return allResults.map(rr => {
      const songsWithPlayers = rr.results.map(result => {
        const player = playerMap.get(result.playerId);
        return {
          ...result,
          player: {
            id: result.playerId,
            name: player?.name || "Unknown Player"
          }
        };
      });

      // Transform to match client expectations (songs instead of results)
      return {
        ...rr,
        songs: songsWithPlayers,
        winnerSongId: rr.winnerSongId,
        round: rr.round,
        roomCode: rr.roomCode
      };
    });
  },
});

export const getCurrentRatingStatus = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const room = await getRoom(ctx, code);
    if (!room || room.phase !== "rating") return { submitted: 0, total: 0 };
    const players = await getPlayers(ctx, code);
    const subs = await ctx.db
      .query("submissions")
      .withIndex("by_room_round", (q) => q.eq("roomCode", code).eq("round", room.currentRound))
      .collect();
    const current = subs[room.currentRatingIndex ?? 0];
    if (!current) return { submitted: 0, total: players.length };
    const ratings = await ctx.db
      .query("ratings")
      .withIndex("by_song", (q) => q.eq("songId", current._id))
      .collect();
    return { submitted: ratings.filter((r) => r.rating > 0).length, total: players.length };
  },
});

export const startRatingPhaseInternal = internalMutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const room = await getRoom(ctx, code);
    if (!room) return;
    await ctx.db.patch(room._id, { phase: "rating", currentRatingIndex: 0, lastActivityAt: now() });
    // Kick off first rating step shortly
    await ctx.scheduler.runAfter(500, internal.game.flow.advanceRating, { code });
  },
});

export const calculateResultsInternal = internalMutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const room = await getRoom(ctx, code);
    if (!room) return;
    const subs = await ctx.db
      .query("submissions")
      .withIndex("by_room_round", (q) => q.eq("roomCode", code).eq("round", room.currentRound))
      .collect();
    const scores: Record<string, number> = {};
    for (const s of subs) {
      const ratings = await ctx.db
        .query("ratings")
        .withIndex("by_song", (q) => q.eq("songId", s._id))
        .collect();
      const total = ratings.filter((r) => r.rating > 0).reduce((sum, r) => sum + r.rating, 0);
      scores[s._id.id] = total;
    }
    const sorted = subs
      .map((s) => ({
        songId: s._id,
        playerId: s.playerId,
        name: s.trackDetails.name,
        artist: s.trackDetails.artist,
        albumCover: s.trackDetails.albumCover,
        totalRecords: scores[s._id.id] || 0,
        submittedAt: s.submittedAt,
        isWinner: false,
      }))
      .sort((a, b) => {
        // Primary sort: by total records (descending)
        if (b.totalRecords !== a.totalRecords) {
          return b.totalRecords - a.totalRecords;
        }
        // Tiebreaker: earliest submission wins
        return a.submittedAt - b.submittedAt;
      });
    if (sorted[0]) sorted[0].isWinner = true;

    // Remove submittedAt before storing (only used for tiebreaker)
    const results = sorted.map(({ submittedAt, ...rest }) => rest);

    await ctx.db.insert("roundResults", {
      roomCode: code,
      round: room.currentRound,
      winnerSongId: sorted[0]?.songId,
      results,
      calculatedAt: now(),
    });
    await ctx.db.patch(room._id, { phase: "results", lastActivityAt: now(), currentRatingIndex: undefined });
  },
});

export const advanceRating = internalMutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const room = await getRoom(ctx, code);
    if (!room || room.phase !== "rating") return;
    const subs = await ctx.db
      .query("submissions")
      .withIndex("by_room_round", (q) => q.eq("roomCode", code).eq("round", room.currentRound))
      .collect();
    const idx = room.currentRatingIndex ?? 0;
    if (idx >= subs.length) {
      // Use scheduler to avoid direct mutation-to-mutation call
      await ctx.scheduler.runAfter(0, internal.game.flow.calculateResultsInternal, { code });
      return;
    }
    // Ensure submitter auto-skip (-1) exists for the current song
    const current = subs[idx];
    if (current) {
      const existing = await ctx.db
        .query("ratings")
        .withIndex("by_song", (q) => q.eq("songId", current._id))
        .collect();
    const hasSubmitterSkip = existing.some((r) => r.voterId === current.playerId && r.rating === -1);
      if (!hasSubmitterSkip) {
        await ctx.db.insert("ratings", {
          roomCode: code,
          round: room.currentRound,
          songId: current._id,
          voterId: current.playerId,
          rating: -1,
          submittedAt: now(),
        });
      }
    }
    // schedule next check/advance after 60s
    await ctx.scheduler.runAfter(60_000, internal.game.flow.advanceRating, { code });
  },
});

export const maybeAdvanceOnAllVotes = internalMutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const room = await getRoom(ctx, code);
    if (!room || room.phase !== "rating") return;
    const players = await getPlayers(ctx, code);
    const subs = await ctx.db
      .query("submissions")
      .withIndex("by_room_round", (q) => q.eq("roomCode", code).eq("round", room.currentRound))
      .collect();
    const idx = room.currentRatingIndex ?? 0;
    const current = subs[idx];
    if (!current) return;
    const ratings = await ctx.db
      .query("ratings")
      .withIndex("by_song", (q) => q.eq("songId", current._id))
      .collect();
    const eligibleVoters = players.length - 1; // submitter doesn't vote
    const validVotes = ratings.filter((r) => r.rating > 0).length;
    if (validVotes >= eligibleVoters) {
      await ctx.db.patch(room._id, { currentRatingIndex: idx + 1, lastActivityAt: now() });
      await ctx.scheduler.runAfter(200, internal.game.flow.advanceRating, { code });
    }
  },
});

// removed ephemeral room state helpers; using persistent currentRatingIndex instead

async function getRoom(ctx: any, code: string) {
  return await ctx.db.query("rooms").withIndex("by_code", (q: any) => q.eq("code", code)).unique();
}

async function getPlayers(ctx: any, code: string) {
  return await ctx.db.query("players").withIndex("by_room", (q: any) => q.eq("roomCode", code)).collect();
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

function pickPrompt(prompts: string[]): string {
  return prompts[Math.floor(Math.random() * prompts.length)];
}


