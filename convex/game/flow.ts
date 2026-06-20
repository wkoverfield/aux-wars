import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalMutation, mutation, query } from "../_generated/server";
// Note: internal.analytics.trackEvent is used for fire-and-forget analytics tracking

function now() { return Date.now(); }

function submitSongFailure(code: string, message: string) {
  return { success: false, code, message };
}

function submitRatingFailure(code: string, message: string) {
  return { success: false, code, message };
}

export const startGame = mutation({
  args: { code: v.string(), playerId: v.string(), connectionId: v.string() },
  handler: async (ctx, { code, playerId, connectionId }) => {
    const room = await getRoom(ctx, code);
    if (!room) return;
    const players = await getPlayers(ctx, code);
    const host = await validateConnection(ctx, code, playerId, connectionId);
    if (!host || !host.isHost) return; // only active host tab
    if (players.length < 3) return; // min players
    const allReady = players.every((p) => p.isReady);
    if (!allReady) return;

    const chosenPrompt = pickPrompt(room.settings.selectedPrompts, []);
    const enablePromptVoting = room.settings.enablePromptVoting !== false; // default true

    if (enablePromptVoting) {
      // Go to prompt voting phase
      await ctx.db.patch(room._id, {
        phase: "promptVoting",
        currentRound: 1,
        currentPrompt: chosenPrompt,
        usedPrompts: [chosenPrompt],
        promptVotingStartedAt: now(),
        skipVotes: [],
        lastActivityAt: now(),
      });

      // Schedule prompt voting timeout (15 seconds)
      await ctx.scheduler.runAfter(
        15_000,
        internal.game.flow.endPromptVoting,
        { code, round: 1 }
      );
    } else {
      // Skip prompt voting, go directly to song selection
      await ctx.db.patch(room._id, {
        phase: "songSelection",
        currentRound: 1,
        currentPrompt: chosenPrompt,
        usedPrompts: [chosenPrompt],
        selectionStartedAt: now(),
        lastActivityAt: now(),
      });

      // Schedule round timeout if roundLength is set
      if (room.settings.roundLength > 0) {
        await ctx.scheduler.runAfter(
          room.settings.roundLength * 1000,
          internal.game.flow.endSelectionPhase,
          { code, round: 1 }
        );
      }
    }

    // Track game started
    await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
      eventType: "game_started",
      metadata: {
        roomCode: code,
        playerCount: players.length,
        totalRounds: room.settings.numberOfRounds,
      },
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
      // A track is EITHER a YouTube video (videoId, full song) OR an
      // iTunes/Deezer preview (previewUrl, 30s) — so both are optional.
      previewUrl: v.optional(v.string()),
      videoId: v.optional(v.string()),
      // For YouTube tracks the window ranges over the full song; for preview
      // tracks it's omitted (the whole 30s clip is the snippet).
      snippet: v.optional(v.object({ startTime: v.number(), endTime: v.number() })),
    }),
  },
  handler: async (ctx, { code, playerId, connectionId, trackId, trackDetails }) => {
    const room = await getRoom(ctx, code);

    if (!room || room.phase !== "songSelection") {
      return submitSongFailure("not_song_selection", "Song selection has already ended.");
    }

    // Validate connection (prevents stale tabs from submitting after takeover)
    const player = await validateConnection(ctx, code, playerId, connectionId);
    if (!player) {
      console.log(`[submitSong] Rejecting submission: connection validation failed`);
      return submitSongFailure("connection_invalid", "Connection issue. Please refresh the page.");
    }

    // Rate limiting: Prevent rapid submission attempts (max 1 per second)
    const lastAttempt = player.lastSubmissionAttempt;
    if (lastAttempt && now() - lastAttempt < 1000) {
      console.log(`[submitSong] Rate limit: Player ${playerId} attempting too quickly`);
      return submitSongFailure("rate_limited", "Please wait a second before submitting again.");
    }

    // Update last attempt timestamp
    await ctx.db.patch(player._id, {
      lastSubmissionAttempt: now()
    });

    const players = await getPlayers(ctx, code);

    // Prevent duplicate submission - check BOTH submittedRounds AND actual DB submissions
    // This handles the case where player crashes/rejoins in same round
    const existingSubmission = await ctx.db
      .query("submissions")
      .withIndex("by_room_round", (q) => q.eq("roomCode", code).eq("round", room.currentRound))
      .filter((q) => q.eq(q.field("playerId"), playerId))
      .first();

    if (existingSubmission) {
      console.log(`[submitSong] Player ${playerId} already has submission in DB for round ${room.currentRound}`);
      // Sync submittedRounds with reality in case it got out of sync
      if (!player.submittedRounds?.includes(room.currentRound)) {
        await ctx.db.patch(player._id, {
          submittedRounds: [...(player.submittedRounds || []), room.currentRound]
        });
      }
      return submitSongFailure("already_submitted", "You already submitted a song for this round.");
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

    // Track song submitted
    await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
      eventType: "song_submitted",
      metadata: { roomCode: code, roundNumber: room.currentRound },
    });

    const subs = await ctx.db
      .query("submissions")
      .withIndex("by_room_round", (q) => q.eq("roomCode", code).eq("round", room.currentRound))
      .order("asc")
      .collect();

    // Robust unique-submitter check
    const submittedPlayerIds = new Set(subs.map((s) => s.playerId));
    const allSubmitted = players.every((p) => submittedPlayerIds.has(p.playerId));

    if (allSubmitted) {
      // Use scheduler to avoid direct mutation-to-mutation call
      await ctx.scheduler.runAfter(0, internal.game.flow.startRatingPhaseInternal, {
        code,
        round: room.currentRound,
      });
    }

    return { success: true };
  },
});

export const submitRating = mutation({
  args: { code: v.string(), playerId: v.string(), connectionId: v.string(), songId: v.id("submissions"), rating: v.number() },
  handler: async (ctx, { code, playerId, connectionId, songId, rating }) => {
    const room = await getRoom(ctx, code);
    if (!room || room.phase !== "rating") {
      return submitRatingFailure("not_rating", "Rating has already ended.");
    }

    // Validate connection (prevents stale tabs from rating after takeover)
    const player = await validateConnection(ctx, code, playerId, connectionId);
    if (!player) {
      console.log(`[submitRating] Rejecting rating: connection validation failed`);
      return submitRatingFailure("connection_invalid", "Connection issue. Please refresh the page.");
    }

    // Rate limiting: Prevent rapid rating attempts (max 1 per second)
    const lastAttempt = player.lastRatingAttempt;
    if (lastAttempt && now() - lastAttempt < 1000) {
      console.log(`[submitRating] Rate limit: Player ${playerId} attempting too quickly`);
      return submitRatingFailure("rate_limited", "Please wait a second before rating again.");
    }

    if (!Number.isInteger(rating) || ![-1, 1, 2, 3, 4, 5].includes(rating)) {
      return submitRatingFailure("invalid_rating", "Rating must be between 1 and 5.");
    }

    const subs = await ctx.db
      .query("submissions")
      .withIndex("by_room_round", (q) => q.eq("roomCode", code).eq("round", room.currentRound))
      .order("asc")
      .collect();
    const current = subs[room.currentRatingIndex ?? 0];
    if (!current || current._id !== songId) {
      return submitRatingFailure("not_current_song", "That song is no longer being rated.");
    }
    if (rating === -1 && current.playerId !== playerId) {
      return submitRatingFailure("invalid_skip", "Only the submitter can skip rating their own song.");
    }

    // Update last attempt timestamp
    await ctx.db.patch(player._id, {
      lastRatingAttempt: now()
    });

    // Check if player already rated this song (prevents duplicate ratings)
    const existingRatings = await ctx.db
      .query("ratings")
      .withIndex("by_song", (q) => q.eq("songId", songId))
      .collect();

    const hasAlreadyVoted = existingRatings.some((r) => r.voterId === playerId);
    if (hasAlreadyVoted) {
      console.log(`[submitRating] Player ${playerId} already rated song ${songId}`);
      return submitRatingFailure("already_rated", "You already rated this song.");
    }

    await ctx.db.insert("ratings", {
      roomCode: code,
      round: room.currentRound,
      songId,
      voterId: playerId,
      rating,
      submittedAt: now(),
    });

    // Track rating submitted
    await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
      eventType: "rating_submitted",
      metadata: { roomCode: code, roundNumber: room.currentRound },
    });

    // After each rating, check if all eligible voters have voted and advance
    // Use scheduler to avoid direct mutation-to-mutation call
    await ctx.scheduler.runAfter(0, internal.game.flow.maybeAdvanceOnAllVotes, { code });
    return { success: true } as const;
  },
});

export const nextRound = mutation({
  args: { code: v.string(), playerId: v.string(), connectionId: v.string() },
  handler: async (ctx, { code, playerId, connectionId }) => {
    const room = await getRoom(ctx, code);
    if (!room) return;
    const host = await validateConnection(ctx, code, playerId, connectionId);
    if (!host || !host.isHost) return;

    const isLastRound = room.currentRound >= room.settings.numberOfRounds;
    if (isLastRound) {
      await ctx.db.patch(room._id, { phase: "gameOver", lastActivityAt: now() });
      return;
    }

    const newRound = room.currentRound + 1;
    const chosenPrompt = pickPrompt(room.settings.selectedPrompts, room.usedPrompts || []);
    const enablePromptVoting = room.settings.enablePromptVoting !== false; // default true

    // Clean submittedRounds for all players in new round
    const players = await getPlayers(ctx, code);
    await Promise.all(
      players.map((p) => ctx.db.patch(p._id, { submittedRounds: [] }))
    );

    if (enablePromptVoting) {
      // Go to prompt voting phase
      await ctx.db.patch(room._id, {
        currentRound: newRound,
        currentPrompt: chosenPrompt,
        usedPrompts: [...(room.usedPrompts || []), chosenPrompt],
        phase: "promptVoting",
        promptVotingStartedAt: now(),
        skipVotes: [],
        lastActivityAt: now(),
      });

      // Schedule prompt voting timeout (15 seconds)
      await ctx.scheduler.runAfter(
        15_000,
        internal.game.flow.endPromptVoting,
        { code, round: newRound }
      );
    } else {
      // Skip prompt voting, go directly to song selection
      await ctx.db.patch(room._id, {
        currentRound: newRound,
        currentPrompt: chosenPrompt,
        usedPrompts: [...(room.usedPrompts || []), chosenPrompt],
        phase: "songSelection",
        selectionStartedAt: now(),
        lastActivityAt: now(),
      });

      // Schedule round timeout if roundLength is set
      if (room.settings.roundLength > 0) {
        await ctx.scheduler.runAfter(
          room.settings.roundLength * 1000,
          internal.game.flow.endSelectionPhase,
          { code, round: newRound }
        );
      }
    }
  },
});

export const returnToLobby = mutation({
  args: { code: v.string(), playerId: v.string(), connectionId: v.string() },
  handler: async (ctx, { code, playerId, connectionId }) => {
    const room = await getRoom(ctx, code);
    if (!room) return;
    const player = await validateConnection(ctx, code, playerId, connectionId);
    if (!player) return;
    // Post-game, ANY player can send the group back to the lobby (decoupled from
    // the host). Mid-game, keep it host-only.
    if (room.phase !== "gameOver" && !player.isHost) return;

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
      usedPrompts: [],
      selectionStartedAt: undefined,
      promptVotingStartedAt: undefined,
      skipVotes: [],
      lastActivityAt: now(),
    });

    const players = await getPlayers(ctx, code);
    await Promise.all(players.map((p) => ctx.db.patch(p._id, { isReady: false, submittedRounds: [] })));
  },
});

// ==================== PLAY AGAIN (REMATCH) ====================

const REMATCH_COUNTDOWN_MS = 3000;

/** Any player can kick off the shared "run it back" countdown from the recap. */
export const startRematch = mutation({
  args: { code: v.string(), playerId: v.string(), connectionId: v.string() },
  handler: async (ctx, { code, playerId, connectionId }) => {
    const room = await getRoom(ctx, code);
    if (!room || room.phase !== "gameOver") return;
    const player = await validateConnection(ctx, code, playerId, connectionId);
    if (!player) return;
    if (room.rematchStartingAt) return; // already counting down — double-taps no-op

    await ctx.db.patch(room._id, { rematchStartingAt: now() + REMATCH_COUNTDOWN_MS, lastActivityAt: now() });
    await ctx.scheduler.runAfter(REMATCH_COUNTDOWN_MS, internal.game.flow.executeRematch, { code });
  },
});

/** Any player can abort the countdown (clears the flag; the scheduled job then no-ops). */
export const cancelRematch = mutation({
  args: { code: v.string(), playerId: v.string(), connectionId: v.string() },
  handler: async (ctx, { code, playerId, connectionId }) => {
    const room = await getRoom(ctx, code);
    if (!room) return;
    const player = await validateConnection(ctx, code, playerId, connectionId);
    if (!player) return;
    if (!room.rematchStartingAt) return;
    await ctx.db.patch(room._id, { rematchStartingAt: undefined, lastActivityAt: now() });
  },
});

/** Scheduled after the countdown: wipe the old game, keep settings, start fresh. */
export const executeRematch = internalMutation({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const room = await getRoom(ctx, code);
    // No-op if cancelled (flag cleared) or the room already moved on.
    if (!room || room.phase !== "gameOver" || !room.rematchStartingAt) return;

    // Wipe previous game data (same as returnToLobby).
    const submissions = await ctx.db
      .query("submissions")
      .withIndex("by_room_round", (q) => q.eq("roomCode", code))
      .collect();
    await Promise.all(submissions.map((s) => ctx.db.delete(s._id)));
    const ratings = await ctx.db
      .query("ratings")
      .withIndex("by_room_round", (q) => q.eq("roomCode", code))
      .collect();
    await Promise.all(ratings.map((r) => ctx.db.delete(r._id)));
    const roundResults = await ctx.db
      .query("roundResults")
      .withIndex("by_room_round", (q) => q.eq("roomCode", code))
      .collect();
    await Promise.all(roundResults.map((rr) => ctx.db.delete(rr._id)));

    const players = await getPlayers(ctx, code);
    await Promise.all(players.map((p: any) => ctx.db.patch(p._id, { isReady: false, submittedRounds: [] })));

    // Start a fresh game with the SAME settings (mirrors startGame, minus the ready gate).
    const chosenPrompt = pickPrompt(room.settings.selectedPrompts, []);
    const enablePromptVoting = room.settings.enablePromptVoting !== false;
    if (enablePromptVoting) {
      await ctx.db.patch(room._id, {
        phase: "promptVoting",
        currentRound: 1,
        currentPrompt: chosenPrompt,
        usedPrompts: [chosenPrompt],
        promptVotingStartedAt: now(),
        skipVotes: [],
        rematchStartingAt: undefined,
        lastActivityAt: now(),
      });
      await ctx.scheduler.runAfter(15_000, internal.game.flow.endPromptVoting, { code, round: 1 });
    } else {
      await ctx.db.patch(room._id, {
        phase: "songSelection",
        currentRound: 1,
        currentPrompt: chosenPrompt,
        usedPrompts: [chosenPrompt],
        selectionStartedAt: now(),
        rematchStartingAt: undefined,
        lastActivityAt: now(),
      });
      if (room.settings.roundLength > 0) {
        await ctx.scheduler.runAfter(room.settings.roundLength * 1000, internal.game.flow.endSelectionPhase, { code, round: 1 });
      }
    }

    await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
      eventType: "game_started",
      metadata: { roomCode: code, playerCount: players.length, totalRounds: room.settings.numberOfRounds },
    });
  },
});

/**
 * Per-voter aggregates for the end-game "judge" awards (The Hater / Easy Grader /
 * Kingmaker). Returns AGGREGATES ONLY — never raw per-song votes — so we don't
 * reveal exactly how someone rated a specific song.
 */
export const getVoterAwards = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const ratings = await ctx.db
      .query("ratings")
      .withIndex("by_room_round", (q) => q.eq("roomCode", code))
      .collect();
    const roundResults = await ctx.db
      .query("roundResults")
      .withIndex("by_room_round", (q) => q.eq("roomCode", code))
      .collect();

    const winnerByRound = new Map<number, any>();
    for (const rr of roundResults) {
      if (rr.winnerSongId) winnerByRound.set(rr.round, rr.winnerSongId);
    }

    const stats = new Map<string, { voterId: string; sum: number; count: number; kingmakerHits: number }>();
    const ensure = (voterId: string) => {
      let s = stats.get(voterId);
      if (!s) { s = { voterId, sum: 0, count: 0, kingmakerHits: 0 }; stats.set(voterId, s); }
      return s;
    };

    // Average rating GIVEN (exclude the -1 own-song skips).
    for (const r of ratings) {
      if (r.rating > 0) {
        const s = ensure(r.voterId);
        s.sum += r.rating;
        s.count += 1;
      }
    }

    // Kingmaker: per voter per round, did their TOP-rated song win that round?
    const byVoterRound = new Map<string, { songId: any; rating: number }[]>();
    for (const r of ratings) {
      if (r.rating <= 0) continue;
      const key = `${r.voterId}|${r.round}`;
      const arr = byVoterRound.get(key) || [];
      arr.push({ songId: r.songId, rating: r.rating });
      byVoterRound.set(key, arr);
    }
    for (const [key, arr] of byVoterRound) {
      const [voterId, roundStr] = key.split("|");
      const winner = winnerByRound.get(Number(roundStr));
      if (!winner) continue;
      const maxRating = Math.max(...arr.map((a) => a.rating));
      if (arr.some((a) => a.songId === winner && a.rating === maxRating)) {
        ensure(voterId).kingmakerHits += 1;
      }
    }

    return Array.from(stats.values()).map((s) => ({
      voterId: s.voterId,
      avgGiven: s.count > 0 ? s.sum / s.count : 0,
      count: s.count,
      kingmakerHits: s.kingmakerHits,
    }));
  },
});

// ==================== PROMPT VOTING ====================

export const voteSkipPrompt = mutation({
  args: { code: v.string(), playerId: v.string(), connectionId: v.string() },
  handler: async (ctx, { code, playerId, connectionId }) => {
    const room = await getRoom(ctx, code);
    if (!room || room.phase !== "promptVoting") return { success: false };

    const players = await getPlayers(ctx, code);
    const player = players.find((p) => p.playerId === playerId);
    if (!player) return { success: false };

    // Validate connection to prevent multi-tab vote manipulation
    if (player.connectionId !== connectionId) {
      return { success: false, message: "Invalid connection" };
    }

    // Rate limiting: Prevent rapid vote attempts (max 1 per 2 seconds)
    const lastAttempt = player.lastVoteSkipAttempt;
    if (lastAttempt && now() - lastAttempt < 2000) {
      console.log(`[voteSkipPrompt] Rate limit: Player ${playerId} attempting too quickly`);
      return { success: false, message: "Please wait before voting again" };
    }

    // Update last attempt timestamp
    await ctx.db.patch(player._id, {
      lastVoteSkipAttempt: now()
    });

    // Check if player already voted
    const currentVotes = room.skipVotes || [];
    if (currentVotes.includes(playerId)) return { success: false };

    // Add vote
    const newVotes = [...currentVotes, playerId];
    const majorityNeeded = Math.floor(players.length / 2) + 1;

    // Check if majority reached
    if (newVotes.length >= majorityNeeded) {
      // Pick a new prompt (excluding the current one)
      const usedPrompts = [...(room.usedPrompts || [])];
      const newPrompt = pickPrompt(room.settings.selectedPrompts, usedPrompts);

      // Update room with new prompt and reset votes
      await ctx.db.patch(room._id, {
        currentPrompt: newPrompt,
        usedPrompts: [...usedPrompts, newPrompt],
        skipVotes: [],
        promptVotingStartedAt: now(), // Reset timer
        lastActivityAt: now(),
      });

      // Reschedule the prompt voting timeout
      await ctx.scheduler.runAfter(
        15_000,
        internal.game.flow.endPromptVoting,
        { code, round: room.currentRound }
      );

      return { success: true, skipped: true, newPrompt };
    } else {
      // Just add the vote
      await ctx.db.patch(room._id, {
        skipVotes: newVotes,
        lastActivityAt: now(),
      });

      return { success: true, skipped: false, votes: newVotes.length, needed: majorityNeeded };
    }
  },
});

export const getPromptVotingStatus = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const room = await getRoom(ctx, code);
    if (!room || room.phase !== "promptVoting") {
      return null;
    }

    const players = await getPlayers(ctx, code);
    const skipVotes = room.skipVotes || [];
    const majorityNeeded = Math.floor(players.length / 2) + 1;
    const timeRemaining = room.promptVotingStartedAt
      ? Math.max(0, 15 - (now() - room.promptVotingStartedAt) / 1000)
      : 0;

    return {
      currentPrompt: room.currentPrompt,
      skipVotes: skipVotes.length,
      totalPlayers: players.length,
      majorityNeeded,
      timeRemaining: Math.ceil(timeRemaining),
      voters: skipVotes, // List of player IDs who voted
    };
  },
});

export const endPromptVoting = internalMutation({
  args: { code: v.string(), round: v.number() },
  handler: async (ctx, { code, round }) => {
    const room = await getRoom(ctx, code);
    if (!room) return;

    // Check if we're still in prompt voting for this round
    if (room.phase !== "promptVoting" || room.currentRound !== round) {
      console.log(`[endPromptVoting] Skipping - phase: ${room.phase}, currentRound: ${room.currentRound}, expected: ${round}`);
      return;
    }

    // Transition to song selection
    await ctx.db.patch(room._id, {
      phase: "songSelection",
      selectionStartedAt: now(),
      promptVotingStartedAt: undefined,
      skipVotes: [],
      lastActivityAt: now(),
    });

    // Schedule selection timeout if roundLength is set
    if (room.settings.roundLength > 0) {
      await ctx.scheduler.runAfter(
        room.settings.roundLength * 1000,
        internal.game.flow.endSelectionPhase,
        { code, round }
      );
    }
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
      .order("asc")
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
      .order("asc")
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
      .order("asc")
      .collect();
    const idx = room.currentRatingIndex ?? 0;

    // Bounds check to prevent out-of-bounds access
    if (idx >= subs.length) return null;

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
      videoId: submission.trackDetails.videoId,
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
      .order("asc")
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

export const endSelectionPhase = internalMutation({
  args: { code: v.string(), round: v.number() },
  handler: async (ctx, { code, round }) => {
    const room = await getRoom(ctx, code);
    if (!room) return;

    // Check if we're still in song selection for this round
    if (room.phase !== "songSelection" || room.currentRound !== round) {
      console.log(`[endSelectionPhase] Skipping - phase: ${room.phase}, currentRound: ${room.currentRound}, expected: ${round}`);
      return;
    }

    // Check if all players have submitted
    const players = await getPlayers(ctx, code);
    const subs = await ctx.db
      .query("submissions")
      .withIndex("by_room_round", (q) => q.eq("roomCode", code).eq("round", round))
      .collect();

    const submittedPlayerIds = new Set(subs.map((s) => s.playerId));
    const allSubmitted = players.every((p) => submittedPlayerIds.has(p.playerId));

    if (allSubmitted) {
      // All submitted - normal transition
      await ctx.scheduler.runAfter(0, internal.game.flow.startRatingPhaseInternal, { code, round });
    } else {
      // Some players didn't submit - force transition anyway
      console.log(`[endSelectionPhase] Time up! ${submittedPlayerIds.size}/${players.length} submitted. Advancing anyway.`);

      // If at least one player submitted, proceed to rating
      if (subs.length > 0) {
        await ctx.scheduler.runAfter(0, internal.game.flow.startRatingPhaseInternal, { code, round });
      } else {
        // No submissions at all - skip to results with no winner
        console.log(`[endSelectionPhase] No submissions for round ${round}. Skipping to results.`);
        await ctx.db.insert("roundResults", {
          roomCode: code,
          round,
          winnerSongId: undefined,
          results: [],
          calculatedAt: now(),
        });
        await ctx.db.patch(room._id, { phase: "results", lastActivityAt: now() });
      }
    }
  },
});

export const startRatingPhaseInternal = internalMutation({
  args: { code: v.string(), round: v.number() },
  handler: async (ctx, { code, round }) => {
    const room = await getRoom(ctx, code);
    if (!room) return;

    if (room.phase !== "songSelection" || room.currentRound !== round) {
      console.log(`[startRatingPhaseInternal] Skipping - phase: ${room.phase}, currentRound: ${room.currentRound}, expected: ${round}`);
      return;
    }

    const subs = await ctx.db
      .query("submissions")
      .withIndex("by_room_round", (q) => q.eq("roomCode", code).eq("round", round))
      .collect();
    if (subs.length === 0) {
      console.log(`[startRatingPhaseInternal] Skipping - no submissions for round ${round}`);
      return;
    }

    await ctx.db.patch(room._id, { phase: "rating", currentRatingIndex: 0, lastActivityAt: now() });
    // Kick off first rating step shortly
    await ctx.scheduler.runAfter(500, internal.game.flow.advanceRating, {
      code,
      round,
      ratingIndex: 0,
      timedOut: false,
    });
  },
});

export const calculateResultsInternal = internalMutation({
  args: { code: v.string(), round: v.optional(v.number()) },
  handler: async (ctx, { code, round }) => {
    const room = await getRoom(ctx, code);
    if (!room) return;
    if (room.phase !== "rating") return;
    if (round !== undefined && room.currentRound !== round) return;
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
      scores[s._id] = total;
    }
    const sorted = subs
      .map((s) => ({
        songId: s._id,
        playerId: s.playerId,
        name: s.trackDetails.name,
        artist: s.trackDetails.artist,
        albumCover: s.trackDetails.albumCover,
        totalRecords: scores[s._id] || 0,
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

    // Track game completed when final round is done
    const isLastRound = room.currentRound >= room.settings.numberOfRounds;
    if (isLastRound) {
      const players = await getPlayers(ctx, code);
      await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
        eventType: "game_completed",
        metadata: {
          roomCode: code,
          playerCount: players.length,
          totalRounds: room.settings.numberOfRounds,
        },
      });
    }
  },
});

export const advanceRating = internalMutation({
  args: {
    code: v.string(),
    round: v.number(),
    ratingIndex: v.number(),
    timedOut: v.optional(v.boolean()),
  },
  handler: async (ctx, { code, round, ratingIndex, timedOut = false }) => {
    const room = await getRoom(ctx, code);
    if (!room || room.phase !== "rating") return;
    if (room.currentRound !== round || (room.currentRatingIndex ?? 0) !== ratingIndex) return;

    const subs = await ctx.db
      .query("submissions")
      .withIndex("by_room_round", (q) => q.eq("roomCode", code).eq("round", round))
      .order("asc")
      .collect();
    if (ratingIndex >= subs.length) {
      // Use scheduler to avoid direct mutation-to-mutation call
      await ctx.scheduler.runAfter(0, internal.game.flow.calculateResultsInternal, { code, round });
      return;
    }
    // Ensure submitter auto-skip (-1) exists for the current song
    const current = subs[ratingIndex];
    if (current) {
      const existing = await ctx.db
        .query("ratings")
        .withIndex("by_song", (q) => q.eq("songId", current._id))
        .collect();
      const hasSubmitterSkip = existing.some((r) => r.voterId === current.playerId && r.rating === -1);
      if (!hasSubmitterSkip) {
        await ctx.db.insert("ratings", {
          roomCode: code,
          round,
          songId: current._id,
          voterId: current.playerId,
          rating: -1,
          submittedAt: now(),
        });
      }
    }

    if (timedOut) {
      const nextIndex = ratingIndex + 1;
      await ctx.db.patch(room._id, { currentRatingIndex: nextIndex, lastActivityAt: now() });
      await ctx.scheduler.runAfter(200, internal.game.flow.advanceRating, {
        code,
        round,
        ratingIndex: nextIndex,
        timedOut: false,
      });
      return;
    }

    await ctx.scheduler.runAfter(60_000, internal.game.flow.advanceRating, {
      code,
      round,
      ratingIndex,
      timedOut: true,
    });
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
      await ctx.scheduler.runAfter(200, internal.game.flow.advanceRating, {
        code,
        round: room.currentRound,
        ratingIndex: idx + 1,
        timedOut: false,
      });
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

function pickPrompt(prompts: string[], usedPrompts: string[] = []): string {
  const available = prompts.filter(p => !usedPrompts.includes(p));
  const pool = available.length > 0 ? available : prompts; // Reset if all used
  return pool[Math.floor(Math.random() * pool.length)];
}
