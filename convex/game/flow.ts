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
    trackId: v.string(),
    trackDetails: v.object({
      name: v.string(),
      artist: v.string(),
      albumCover: v.string(),
      previewUrl: v.string(),
      snippet: v.optional(v.object({ startTime: v.number(), endTime: v.number() })),
    }),
  },
  handler: async (ctx, { code, playerId, trackId, trackDetails }) => {
    console.log(`[submitSong] Starting submission for player ${playerId} in room ${code}`);
    
    const room = await getRoom(ctx, code);
    console.log(`[submitSong] Room phase: ${room?.phase}, currentRound: ${room?.currentRound}`);
    
    if (!room || room.phase !== "songSelection") {
      console.log(`[submitSong] Early return - room: ${!!room}, phase: ${room?.phase}`);
      return;
    }
    // Prevent duplicate submission by the same player in the same round
    const existingForPlayerThisRound = await ctx.db
      .query("submissions")
      .withIndex("by_room_round", (q) => q.eq("roomCode", code).eq("round", room.currentRound))
      .collect();
    const alreadySubmitted = existingForPlayerThisRound.find((s) => s.playerId === playerId);
    if (alreadySubmitted) {
      console.log(`[submitSong] Player ${playerId} already submitted for round ${room.currentRound}, skipping insert`);
    } else {
      await ctx.db.insert("submissions", {
        roomCode: code,
        round: room.currentRound,
        playerId,
        trackId,
        trackDetails,
        submittedAt: now(),
      });
    }
    
    const players = await getPlayers(ctx, code);
    const subs = await ctx.db
      .query("submissions")
      .withIndex("by_room_round", (q) => q.eq("roomCode", code).eq("round", room.currentRound))
      .collect();
      
    console.log(`[submitSong] Players: ${players.length}, Submissions: ${subs.length}`);
    console.log(`[submitSong] Player IDs:`, players.map(p => p.playerId));
    console.log(`[submitSong] Submission player IDs:`, subs.map(s => s.playerId));
    
    // Robust unique-submitter check
    const submittedPlayerIds = new Set(subs.map((s) => s.playerId));
    const allSubmitted = players.every((p) => submittedPlayerIds.has(p.playerId));
    console.log(`[submitSong] All submitted: ${allSubmitted}`);
    
    if (allSubmitted) {
      console.log(`[submitSong] Starting rating phase!`);
      await startRatingPhaseInternal(ctx, { code });
    }
  },
});

export const submitRating = mutation({
  args: { code: v.string(), playerId: v.string(), songId: v.id("submissions"), rating: v.number() },
  handler: async (ctx, { code, playerId, songId, rating }) => {
    const room = await getRoom(ctx, code);
    if (!room || room.phase !== "rating") return;
    await ctx.db.insert("ratings", {
      roomCode: code,
      round: room.currentRound,
      songId,
      voterId: playerId,
      rating,
      submittedAt: now(),
    });
    // After each rating, check if all eligible voters have voted and advance
    await maybeAdvanceOnAllVotes(ctx, { code });
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
  },
});

export const returnToLobby = mutation({
  args: { code: v.string(), playerId: v.string() },
  handler: async (ctx, { code, playerId }) => {
    const room = await getRoom(ctx, code);
    if (!room) return;
    const host = room.hostPlayerId ? await ctx.db.get(room.hostPlayerId) : null;
    if (!host || host.playerId !== playerId) return;

    await ctx.db.patch(room._id, {
      phase: "lobby",
      currentRound: 1,
      currentPrompt: undefined,
      lastActivityAt: now(),
    });

    const players = await getPlayers(ctx, code);
    await Promise.all(players.map((p) => ctx.db.patch(p._id, { isReady: false })));
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
    return subs[idx] ?? null;
  },
});

export const getRoundResults = query({
  args: { code: v.string(), round: v.number() },
  handler: async (ctx, { code, round }) => {
    const rr = await ctx.db
      .query("roundResults")
      .withIndex("by_room_round", (q) => q.eq("roomCode", code).eq("round", round))
      .unique();
    return rr ?? null;
  },
});

export const getAllRoundResults = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    return await ctx.db
      .query("roundResults")
      .withIndex("by_room_round", (q) => q.eq("roomCode", code))
      .collect();
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
    console.log(`[startRatingPhaseInternal] Starting rating phase for room ${code}`);
    const room = await getRoom(ctx, code);
    if (!room) {
      console.log(`[startRatingPhaseInternal] Room not found for code ${code}`);
      return;
    }
    console.log(`[startRatingPhaseInternal] Updating room phase from ${room.phase} to rating`);
    await ctx.db.patch(room._id, { phase: "rating", currentRatingIndex: 0, lastActivityAt: now() });
    console.log(`[startRatingPhaseInternal] Room phase updated, scheduling advanceRating`);
    // kick off first rating step shortly
    await ctx.scheduler.runAfter(500, internal.game.flow.advanceRating, { code });
    console.log(`[startRatingPhaseInternal] advanceRating scheduled for 500ms from now`);
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
        isWinner: false,
      }))
      .sort((a, b) => b.totalRecords - a.totalRecords);
    if (sorted[0]) sorted[0].isWinner = true;
    await ctx.db.insert("roundResults", {
      roomCode: code,
      round: room.currentRound,
      winnerSongId: sorted[0]?.songId,
      results: sorted,
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
      await calculateResultsInternal(ctx, { code });
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

function pickPrompt(prompts: string[]): string {
  return prompts[Math.floor(Math.random() * prompts.length)];
}


