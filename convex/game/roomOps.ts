import type { MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { presence } from "../presence";

/**
 * Room-level game primitives shared by the host-driven flow (flow.ts) and the
 * hostless Quick Play flow (publicRooms.ts). Plain functions, no registered
 * Convex functions, so both sides import them without a module cycle.
 */

export type Room = Doc<"rooms">;
export type Player = Doc<"players">;
export type RoomPatch = Partial<Omit<Room, "_id" | "_creationTime">>;

const PROMPT_VOTING_MS = 15_000;

function now() {
  return Date.now();
}

export async function getRoom(ctx: MutationCtx, code: string): Promise<Room | null> {
  return await ctx.db
    .query("rooms")
    .withIndex("by_code", (q) => q.eq("code", code))
    .unique();
}

export async function getRoomPlayers(ctx: MutationCtx, code: string): Promise<Player[]> {
  return await ctx.db
    .query("players")
    .withIndex("by_room", (q) => q.eq("roomCode", code))
    .collect();
}

export function pickPrompt(prompts: string[], usedPrompts: string[] = []): string {
  const available = prompts.filter((p) => !usedPrompts.includes(p));
  const pool = available.length > 0 ? available : prompts; // Reset if all used
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Starts round 1 with the room's settings: prompt voting when enabled, else
 * straight to song selection. `extraPatch` rides on the same room write.
 * Records game_started (labelled "quickplay" for public rooms).
 */
export async function launchFirstRound(
  ctx: MutationCtx,
  room: Room,
  playerCount: number,
  extraPatch: RoomPatch = {}
) {
  const code = room.code;
  const chosenPrompt = pickPrompt(room.settings.selectedPrompts, []);
  const enablePromptVoting = room.settings.enablePromptVoting !== false; // default true

  if (enablePromptVoting) {
    await ctx.db.patch(room._id, {
      ...extraPatch,
      phase: "promptVoting",
      currentRound: 1,
      currentPrompt: chosenPrompt,
      usedPrompts: [chosenPrompt],
      promptVotingStartedAt: now(),
      skipVotes: [],
      lastActivityAt: now(),
    });
    await ctx.scheduler.runAfter(PROMPT_VOTING_MS, internal.game.flow.endPromptVoting, { code, round: 1 });
  } else {
    await ctx.db.patch(room._id, {
      ...extraPatch,
      phase: "songSelection",
      currentRound: 1,
      currentPrompt: chosenPrompt,
      usedPrompts: [chosenPrompt],
      selectionStartedAt: now(),
      lastActivityAt: now(),
    });
    if (room.settings.roundLength > 0) {
      await ctx.scheduler.runAfter(room.settings.roundLength * 1000, internal.game.flow.endSelectionPhase, {
        code,
        round: 1,
      });
    }
  }

  await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
    eventType: "game_started",
    metadata: {
      roomCode: code,
      playerCount,
      totalRounds: room.settings.numberOfRounds,
      ...(room.isPublic ? { label: "quickplay" } : {}),
    },
  });
}

/**
 * Moves a room in results to the next round, or to gameOver after the last
 * round. Returns which one happened.
 */
export async function advanceToNextRound(ctx: MutationCtx, room: Room): Promise<"gameOver" | "nextRound"> {
  const code = room.code;
  const isLastRound = room.currentRound >= room.settings.numberOfRounds;
  if (isLastRound) {
    await ctx.db.patch(room._id, { phase: "gameOver", lastActivityAt: now() });
    return "gameOver";
  }

  const newRound = room.currentRound + 1;
  const chosenPrompt = pickPrompt(room.settings.selectedPrompts, room.usedPrompts || []);
  const enablePromptVoting = room.settings.enablePromptVoting !== false; // default true

  // Clean submittedRounds for all players in new round
  const players = await getRoomPlayers(ctx, code);
  await Promise.all(players.map((p) => ctx.db.patch(p._id, { submittedRounds: [] })));

  if (enablePromptVoting) {
    await ctx.db.patch(room._id, {
      currentRound: newRound,
      currentPrompt: chosenPrompt,
      usedPrompts: [...(room.usedPrompts || []), chosenPrompt],
      phase: "promptVoting",
      promptVotingStartedAt: now(),
      skipVotes: [],
      lastActivityAt: now(),
    });
    await ctx.scheduler.runAfter(PROMPT_VOTING_MS, internal.game.flow.endPromptVoting, { code, round: newRound });
  } else {
    await ctx.db.patch(room._id, {
      currentRound: newRound,
      currentPrompt: chosenPrompt,
      usedPrompts: [...(room.usedPrompts || []), chosenPrompt],
      phase: "songSelection",
      selectionStartedAt: now(),
      lastActivityAt: now(),
    });
    if (room.settings.roundLength > 0) {
      await ctx.scheduler.runAfter(room.settings.roundLength * 1000, internal.game.flow.endSelectionPhase, {
        code,
        round: newRound,
      });
    }
  }
  return "nextRound";
}

/** Deletes a finished game's submissions, ratings and round results. */
export async function wipeGameData(ctx: MutationCtx, code: string) {
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
}

/** Deletes a room and everything keyed by its code, including presence. */
export async function deleteRoomCascade(ctx: MutationCtx, room: Room) {
  const code = room.code;
  const players = await getRoomPlayers(ctx, code);
  for (const player of players) await ctx.db.delete(player._id);
  await wipeGameData(ctx, code);
  const customPrompts = await ctx.db
    .query("customPrompts")
    .withIndex("by_room", (q) => q.eq("roomCode", code))
    .collect();
  for (const prompt of customPrompts) await ctx.db.delete(prompt._id);
  const rateLimits = await ctx.db
    .query("playerRateLimits")
    .withIndex("by_room", (q) => q.eq("roomCode", code))
    .collect();
  for (const row of rateLimits) await ctx.db.delete(row._id);
  await ctx.db.delete(room._id);
  await presence.removeRoom(ctx, code);
}

/** A 6-character room code no existing room uses. */
export async function generateRoomCode(ctx: MutationCtx): Promise<string> {
  const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  for (;;) {
    let code = "";
    for (let i = 0; i < 6; i++) {
      code += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    if (!(await getRoom(ctx, code))) return code;
  }
}
