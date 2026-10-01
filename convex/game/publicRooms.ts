import type { MutationCtx } from "../_generated/server";
import type { EventMetadata } from "../analytics";
import { internal } from "../_generated/api";
import { presence } from "../presence";
import {
  deleteRoomCascade,
  getRoom,
  getRoomPlayers,
  launchFirstRound,
  wipeGameData,
  type Player,
  type Room,
  type RoomPatch,
} from "./roomOps";
import {
  COUNTDOWN_EXTEND_MS,
  COUNTDOWN_MAX_MS,
  COUNTDOWN_MIN_PLAYERS,
  COUNTDOWN_MS,
  ONE_V_ONE_OFFER_MS,
  PUBLIC_WAITING_TIMEOUT_MS,
  QUICK_PLAY_CAP,
} from "./quickPlayRules";

/**
 * Quick Play room state machine helpers (public, hostless rooms).
 *
 * Lobby rule: wait with 2; at 3 a countdown arms (startsAt); each join pushes
 * it back by up to COUNTDOWN_EXTEND_MS, never past COUNTDOWN_MAX_MS after it
 * armed; dropping under 3 cancels it; 6 starts at once. With exactly 2 a 1v1
 * offer fires after ONE_V_ONE_OFFER_MS and starts only when both accept. A
 * unanimous "Start now" vote (2+ players) starts at once.
 *
 * Every timer stores its fire time on the room and schedules a guarded
 * internal mutation that no-ops unless the stored value still matches, so a
 * cancelled or rescheduled timer can never fire stale.
 */

export type LobbyChange = "join" | "leave" | "refresh";
type LaunchReason = "countdown" | "full" | "vote" | "1v1" | "rematch";

/** Lobby-only state, cleared whenever a public room leaves the lobby. */
const CLEARED_LOBBY_STATE: RoomPatch = {
  startsAt: undefined,
  countdownArmedAt: undefined,
  startVotes: undefined,
  oneVOneOfferAt: undefined,
  oneVOneOffered: undefined,
  oneVOneAccepts: undefined,
};

function now() {
  return Date.now();
}

async function track(ctx: MutationCtx, eventType: string, metadata: EventMetadata) {
  await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, { eventType, metadata });
}

const sameList = (a: string[] | undefined, b: string[] | undefined) =>
  JSON.stringify(a ?? []) === JSON.stringify(b ?? []);

type KickVote = { targetPlayerId: string; voterIds: string[] };

/** Kick votes with departed targets and voters dropped. */
export function liveKickVotes(votes: KickVote[] | undefined, playerIds: Set<string>): KickVote[] {
  return (votes ?? [])
    .filter((kv) => playerIds.has(kv.targetPlayerId))
    .map((kv) => ({ ...kv, voterIds: kv.voterIds.filter((id) => playerIds.has(id)) }))
    .filter((kv) => kv.voterIds.length > 0);
}

/** Votes needed to kick someone: a majority of the other players. */
export function kickVotesNeeded(playerCount: number): number {
  return Math.floor((playerCount - 1) / 2) + 1;
}

/**
 * Deletes one player from a public room (no follow-up). Records
 * quickplay_left_waiting when they were still waiting for their first game.
 */
export async function removePublicPlayer(ctx: MutationCtx, room: Room, player: Player) {
  await ctx.db.delete(player._id);
  await presence.removeRoomUser(ctx, room.code, player.playerId);
  if (player.waitingSince !== undefined) {
    await track(ctx, "quickplay_left_waiting", {
      roomCode: room.code,
      playerId: player.playerId,
      waitedMs: Math.max(0, now() - player.waitingSince),
    });
  }
}

/**
 * Removes players the presence component has reported offline for longer than
 * PUBLIC_WAITING_TIMEOUT_MS. Players with no presence entry yet are kept (the
 * first heartbeat can trail the join). Returns who is left.
 */
export async function dropKnownOffline(ctx: MutationCtx, room: Room, players: Player[]): Promise<Player[]> {
  const entries = await presence.listRoom(ctx, room.code, false);
  const byUser = new Map(entries.map((e) => [e.userId, e]));
  const cutoff = now() - PUBLIC_WAITING_TIMEOUT_MS;
  const kept: Player[] = [];
  for (const p of players) {
    const entry = byUser.get(p.playerId);
    if (entry && !entry.online && entry.lastDisconnected < cutoff) {
      await removePublicPlayer(ctx, room, p);
    } else {
      kept.push(p);
    }
  }
  return kept;
}

/**
 * Starts round 1 of a public room for `players` (already pruned). Records
 * quickplay_matched for everyone still waiting for their first game.
 */
export async function startPublicGame(ctx: MutationCtx, room: Room, players: Player[], reason: LaunchReason) {
  const t = now();
  for (const p of players) {
    if (p.waitingSince === undefined) continue;
    await track(ctx, "quickplay_matched", {
      roomCode: room.code,
      playerId: p.playerId,
      waitedMs: Math.max(0, t - p.waitingSince),
      playersAtStart: players.length,
    });
    await ctx.db.patch(p._id, { waitingSince: undefined });
  }
  if (reason === "1v1") {
    await track(ctx, "quickplay_1v1_accepted", { roomCode: room.code });
  }
  await launchFirstRound(ctx, room, players.length, {
    ...CLEARED_LOBBY_STATE,
    rematchStartingAt: undefined,
    autoAdvanceAt: undefined,
    kickVotes: [],
  });
}

/**
 * Launches a public lobby after dropping known-offline players. If anyone was
 * dropped the lobby is re-evaluated instead, so a start condition is always
 * judged on the players actually there.
 */
async function launchLobby(ctx: MutationCtx, room: Room, players: Player[], reason: LaunchReason) {
  const present = await dropKnownOffline(ctx, room, players);
  if (present.length === players.length) {
    await startPublicGame(ctx, room, present, reason);
    return;
  }
  await settlePublicRoom(ctx, room.code, "leave");
}

/**
 * Brings a public lobby's countdown, votes and 1v1 offer in line with who is
 * in it, launching when a start condition holds. Writes only changed fields.
 */
export async function reconcileLobby(ctx: MutationCtx, room: Room, players: Player[], change: LobbyChange) {
  if (!room.isPublic || room.phase !== "lobby") return;
  const n = players.length;
  if (n === 0) {
    await deleteRoomCascade(ctx, room);
    return;
  }
  const ids = new Set(players.map((p) => p.playerId));
  const t = now();

  if (n >= QUICK_PLAY_CAP) return await launchLobby(ctx, room, players, "full");

  const startVotes = (room.startVotes ?? []).filter((id) => ids.has(id));
  if (n >= 2 && players.every((p) => startVotes.includes(p.playerId))) {
    return await launchLobby(ctx, room, players, "vote");
  }

  let oneVOneAccepts = (room.oneVOneAccepts ?? []).filter((id) => ids.has(id));
  let oneVOneOffered = room.oneVOneOffered === true;
  let oneVOneOfferAt = room.oneVOneOfferAt;
  if (n === 2 && oneVOneOffered && players.every((p) => oneVOneAccepts.includes(p.playerId))) {
    return await launchLobby(ctx, room, players, "1v1");
  }

  let startsAt = room.startsAt;
  let countdownArmedAt = room.countdownArmedAt;
  if (n >= COUNTDOWN_MIN_PLAYERS) {
    if (startsAt === undefined || countdownArmedAt === undefined) {
      countdownArmedAt = t;
      startsAt = t + COUNTDOWN_MS;
    } else if (change === "join") {
      const extended = Math.min(startsAt + COUNTDOWN_EXTEND_MS, countdownArmedAt + COUNTDOWN_MAX_MS);
      startsAt = Math.max(startsAt, extended);
    }
  } else {
    startsAt = undefined;
    countdownArmedAt = undefined;
  }

  if (n === 2) {
    if (!oneVOneOffered && oneVOneOfferAt === undefined) oneVOneOfferAt = t + ONE_V_ONE_OFFER_MS;
  } else {
    oneVOneOfferAt = undefined;
    oneVOneOffered = false;
    oneVOneAccepts = [];
  }

  const patch: RoomPatch = {};
  if (startsAt !== room.startsAt) patch.startsAt = startsAt;
  if (countdownArmedAt !== room.countdownArmedAt) patch.countdownArmedAt = countdownArmedAt;
  if (!sameList(startVotes, room.startVotes)) patch.startVotes = startVotes;
  if (oneVOneOfferAt !== room.oneVOneOfferAt) patch.oneVOneOfferAt = oneVOneOfferAt;
  if (oneVOneOffered !== (room.oneVOneOffered === true)) patch.oneVOneOffered = oneVOneOffered;
  if (!sameList(oneVOneAccepts, room.oneVOneAccepts)) patch.oneVOneAccepts = oneVOneAccepts;
  const kickVotes = liveKickVotes(room.kickVotes, ids);
  if (JSON.stringify(kickVotes) !== JSON.stringify(room.kickVotes ?? [])) patch.kickVotes = kickVotes;
  if (Object.keys(patch).length === 0) return;

  await ctx.db.patch(room._id, patch);
  if (patch.startsAt !== undefined) {
    await ctx.scheduler.runAfter(patch.startsAt - t, internal.quickPlay.fireCountdown, {
      code: room.code,
      startsAt: patch.startsAt,
    });
  }
  if (patch.oneVOneOfferAt !== undefined) {
    await ctx.scheduler.runAfter(patch.oneVOneOfferAt - t, internal.quickPlay.fireOneVOneOffer, {
      code: room.code,
      offerAt: patch.oneVOneOfferAt,
    });
  }
}

/** Sends a public room back to the waiting lobby with a clean slate. */
async function returnPublicToLobby(ctx: MutationCtx, room: Room, players: Player[]) {
  await wipeGameData(ctx, room.code);
  await Promise.all(players.map((p) => ctx.db.patch(p._id, { isReady: false, submittedRounds: [] })));
  await ctx.db.patch(room._id, {
    ...CLEARED_LOBBY_STATE,
    phase: "lobby",
    currentRound: 1,
    currentPrompt: undefined,
    currentRatingIndex: undefined,
    usedPrompts: [],
    selectionStartedAt: undefined,
    promptVotingStartedAt: undefined,
    skipVotes: [],
    rematchStartingAt: undefined,
    autoAdvanceAt: undefined,
    kickVotes: [],
    lastActivityAt: now(),
  });
  const fresh = await ctx.db.get(room._id);
  if (fresh) await reconcileLobby(ctx, fresh, players, "refresh");
}

/**
 * Re-evaluates a public room after its membership changed: deletes it when
 * empty, recomputes the lobby, keeps a running game moving without the
 * departed player, and returns a game that fell under 2 players to the lobby.
 */
export async function settlePublicRoom(
  ctx: MutationCtx,
  code: string,
  change: LobbyChange
): Promise<{ roomDeleted: boolean }> {
  const room = await getRoom(ctx, code);
  if (!room) return { roomDeleted: true };
  const players = await getRoomPlayers(ctx, code);
  if (players.length === 0) {
    await deleteRoomCascade(ctx, room);
    return { roomDeleted: true };
  }

  if (room.phase === "lobby") {
    await reconcileLobby(ctx, room, players, change);
    return { roomDeleted: false };
  }

  const ids = new Set(players.map((p) => p.playerId));
  const kickVotes = liveKickVotes(room.kickVotes, ids);
  if (JSON.stringify(kickVotes) !== JSON.stringify(room.kickVotes ?? [])) {
    await ctx.db.patch(room._id, { kickVotes });
  }

  if (room.phase === "gameOver") return { roomDeleted: false }; // the rematch handles a short room

  if (players.length < 2) {
    await returnPublicToLobby(ctx, room, players);
    return { roomDeleted: false };
  }

  if (room.phase === "songSelection") {
    const subs = await ctx.db
      .query("submissions")
      .withIndex("by_room_round", (q) => q.eq("roomCode", code).eq("round", room.currentRound))
      .collect();
    const submitted = new Set(subs.map((s) => s.playerId));
    if (subs.length > 0 && players.every((p) => submitted.has(p.playerId))) {
      await ctx.scheduler.runAfter(0, internal.game.flow.startRatingPhaseInternal, {
        code,
        round: room.currentRound,
      });
    }
  } else if (room.phase === "rating") {
    await ctx.scheduler.runAfter(0, internal.game.flow.maybeAdvanceOnAllVotes, { code });
  }
  return { roomDeleted: false };
}

/** A player leaves a public room voluntarily. */
export async function leavePublicRoom(ctx: MutationCtx, room: Room, player: Player) {
  await removePublicPlayer(ctx, room, player);
  await track(ctx, "player_left", { roomCode: room.code, playerId: player.playerId });
  return await settlePublicRoom(ctx, room.code, "leave");
}

/**
 * The auto-rematch fired: wipe the finished game and start the next one with
 * everyone still here (including players seated during the countdown), or
 * fall back to the waiting lobby when fewer than 2 remain.
 */
export async function startPublicRematch(ctx: MutationCtx, room: Room) {
  await wipeGameData(ctx, room.code);
  const players = await getRoomPlayers(ctx, room.code);
  await Promise.all(players.map((p) => ctx.db.patch(p._id, { isReady: false, submittedRounds: [] })));
  const present = await dropKnownOffline(ctx, room, players);
  if (present.length === 0) {
    await deleteRoomCascade(ctx, room);
    return;
  }
  const fresh = (await ctx.db.get(room._id))!;
  if (present.length >= 2) {
    await startPublicGame(ctx, fresh, present, "rematch");
  } else {
    await returnPublicToLobby(ctx, fresh, present);
  }
}
