import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { containsHateSpeech } from "./game/contentFilter";
import { cleanVisitorId, recordVisitorPlayed } from "./siteStats";
import { presence } from "./presence";
import {
  generateRoomCode,
  getRoom,
  getRoomPlayers,
  hashSeatKey,
  isValidSeatKey,
  mayTakeOverSeat,
  type Player,
  type Room,
} from "./game/roomOps";
import {
  dropKnownOffline,
  kickVotesNeeded,
  leavePublicRoom,
  liveKickVotes,
  reconcileLobby,
  removePublicPlayer,
  settlePublicRoom,
  startPublicGame,
} from "./game/publicRooms";
import {
  COUNTDOWN_MIN_PLAYERS,
  JOIN_REMATCH_MARGIN_MS,
  JOIN_START_MARGIN_MS,
  ONE_V_ONE_OFFER_MS,
  PLACEMENT_RECENT_MS,
  QUICK_PLAY_CAP,
  generateFunName,
  quickPlaySettings,
} from "./game/quickPlayRules";

/**
 * Quick Play: hostless public matchmaking.
 *
 * join seats a player in the open public room closest to starting, or opens
 * one. Placement reads the by_public_phase index range and the candidate
 * rooms' players inside one mutation, so Convex's serializable transactions
 * make concurrent joins conflict and retry rather than each opening a room.
 *
 * Room lifecycle and timers live in game/publicRooms.ts; the hostless game
 * flow (auto-advance, auto-rematch) in game/flow.ts. Rename goes through
 * game/rooms.updatePlayerName and leave through game/rooms.leaveGame, which
 * both handle public rooms.
 */

// Open rooms scanned per placement. Liquidity is a handful of rooms at a time;
// the bound only keeps the read set finite.
const MAX_OPEN_ROOMS_SCANNED = 50;
const MAX_MEMBERSHIPS_SCANNED = 20;

function now() {
  return Date.now();
}

async function validateConnection(ctx: MutationCtx, code: string, playerId: string, connectionId: string) {
  const player = await ctx.db
    .query("players")
    .withIndex("by_player", (q) => q.eq("playerId", playerId).eq("roomCode", code))
    .unique();
  if (!player || player.connectionId !== connectionId) return null;
  return player;
}

/** Validated public room and caller, or a failure message. */
async function publicRoomAndPlayer(
  ctx: MutationCtx,
  code: string,
  playerId: string,
  connectionId: string
): Promise<{ room: Room; player: Player } | { error: string }> {
  const room = await getRoom(ctx, code);
  if (!room || !room.isPublic) return { error: "Quick Play room not found" };
  const player = await validateConnection(ctx, code, playerId, connectionId);
  if (!player) return { error: "Connection issue. Please refresh the page." };
  return { room, player };
}

/** True when a public room may take a new player right now. */
function acceptsNewPlayers(room: Room, playerId: string, t: number): boolean {
  if (room.kickedPlayerIds?.includes(playerId)) return false;
  if (room.phase === "lobby") {
    return room.startsAt === undefined || room.startsAt > t + JOIN_START_MARGIN_MS;
  }
  if (room.phase === "gameOver") {
    return room.rematchStartingAt !== undefined && room.rematchStartingAt > t + JOIN_REMATCH_MARGIN_MS;
  }
  return false; // never seat anyone in a started game
}

type PresenceEntry = { userId: string; online: boolean; lastDisconnected: number };

async function presenceByUser(ctx: QueryCtx | MutationCtx, code: string) {
  const entries: PresenceEntry[] = await presence.listRoom(ctx, code, false);
  return new Map(entries.map((e) => [e.userId, e]));
}

/**
 * Players placement treats as really there: online, or offline (or joined
 * with no heartbeat yet) less than PLACEMENT_RECENT_MS ago.
 */
function livePlayerCount(players: Player[], byUser: Map<string, PresenceEntry>, t: number): number {
  const cutoff = t - PLACEMENT_RECENT_MS;
  let live = 0;
  for (const p of players) {
    const entry = byUser.get(p.playerId);
    if (entry?.online) live++;
    else if ((entry ? entry.lastDisconnected : (p.connectedAt ?? p._creationTime)) >= cutoff) live++;
  }
  return live;
}

export const join = mutation({
  args: {
    playerId: v.string(),
    connectionId: v.string(),
    // Secret the client keeps next to playerId; proves ownership of the seat
    // on rejoin (see seat keys in game/roomOps.ts).
    seatKey: v.string(),
    name: v.optional(v.string()), // omitted: the server assigns a fun name
    visitorId: v.optional(v.string()),
  },
  handler: async (ctx, { playerId, connectionId, seatKey, name, visitorId }) => {
    if (!playerId.trim() || playerId.length > 100 || !connectionId || connectionId.length > 200) {
      return { success: false, message: "Invalid player" } as const;
    }
    if (!isValidSeatKey(seatKey)) {
      return { success: false, message: "Invalid player" } as const;
    }

    let requestedName: string | undefined;
    if (name !== undefined && name.trim() !== "") {
      requestedName = name.trim();
      if (requestedName.length > 50) {
        return { success: false, message: "Name must be between 1 and 50 characters" } as const;
      }
      if (containsHateSpeech(requestedName)) {
        return { success: false, message: "Please choose a different name" } as const;
      }
    }

    // Already seated in a public room (double click, second tab, came back
    // from the homepage): take over the connection there instead of seating
    // the same player twice. Only with that seat's key: playerIds are visible
    // to everyone in the room, so a playerId alone proves nothing.
    const memberships = await ctx.db
      .query("players")
      .withIndex("by_player", (q) => q.eq("playerId", playerId))
      .take(MAX_MEMBERSHIPS_SCANNED);
    for (const m of memberships) {
      const room = await getRoom(ctx, m.roomCode);
      if (!room?.isPublic) continue;
      if (!(await mayTakeOverSeat(room, m, seatKey))) {
        return { success: false, message: "This player is already in a Quick Play game" } as const;
      }
      await ctx.db.patch(m._id, { connectionId, connectedAt: now(), isActive: true, closingAt: undefined });
      await ctx.db.patch(room._id, { lastActivityAt: now() });
      return { success: true, code: room.code, name: m.name, playerId, rejoined: true } as const;
    }

    // Placement: the open room with the most live players (then most seated,
    // then oldest). A room whose players have all gone quiet (closed tabs the
    // cleanup cron has not swept yet) is skipped: a newcomer would only wait
    // with ghosts.
    const t = now();
    const open = [
      ...(await ctx.db
        .query("rooms")
        .withIndex("by_public_phase", (q) => q.eq("isPublic", true).eq("phase", "lobby"))
        .take(MAX_OPEN_ROOMS_SCANNED)),
      ...(await ctx.db
        .query("rooms")
        .withIndex("by_public_phase", (q) => q.eq("isPublic", true).eq("phase", "gameOver"))
        .take(MAX_OPEN_ROOMS_SCANNED)),
    ];
    let best: { room: Room; players: Player[]; live: number } | null = null;
    for (const room of open) {
      if (!acceptsNewPlayers(room, playerId, t)) continue;
      const players = await getRoomPlayers(ctx, room.code);
      if (players.length >= QUICK_PLAY_CAP) continue;
      // The membership scan above is bounded, so a playerId seated in many
      // rooms can slip past it. Never seat a playerId twice in one room.
      if (players.some((p) => p.playerId === playerId)) continue;
      const live = livePlayerCount(players, await presenceByUser(ctx, room.code), t);
      if (live === 0) continue;
      if (
        !best ||
        live > best.live ||
        (live === best.live && players.length > best.players.length) ||
        (live === best.live &&
          players.length === best.players.length &&
          room._creationTime < best.room._creationTime)
      ) {
        best = { room, players, live };
      }
    }

    const cleanVisitor = cleanVisitorId(visitorId);
    const visitorMeta = cleanVisitor ? { visitorId: cleanVisitor } : {};
    let room: Room;
    let seated: Player[];
    if (best) {
      room = best.room;
      seated = best.players;
    } else {
      const code = await generateRoomCode(ctx);
      const roomId = await ctx.db.insert("rooms", {
        code,
        phase: "lobby",
        currentRound: 1,
        isPublic: true,
        settings: quickPlaySettings(),
        createdAt: t,
        lastActivityAt: t,
      });
      room = (await ctx.db.get(roomId))!;
      seated = [];
      await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
        eventType: "game_created",
        metadata: { roomCode: code, label: "quickplay", ...visitorMeta },
      });
    }

    const playerName = requestedName ?? generateFunName(seated.map((p) => p.name));
    await ctx.db.insert("players", {
      roomCode: room.code,
      playerId,
      connectionId,
      seatKeyHash: await hashSeatKey(seatKey),
      name: playerName,
      isHost: false,
      isReady: false,
      connectedAt: t,
      isActive: true,
      waitingSince: t,
    });

    for (const eventType of ["quickplay_clicked", "player_joined"]) {
      await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
        eventType,
        metadata: { roomCode: room.code, playerId, ...visitorMeta },
      });
    }
    if (cleanVisitor) await recordVisitorPlayed(ctx, cleanVisitor, new Date(t).toISOString().slice(0, 10));

    await ctx.db.patch(room._id, { lastActivityAt: t });
    if (room.phase === "lobby") {
      const fresh = (await ctx.db.get(room._id))!;
      await reconcileLobby(ctx, fresh, await getRoomPlayers(ctx, room.code), "join");
    }

    return { success: true, code: room.code, name: playerName, playerId, rejoined: false } as const;
  },
});

/**
 * Players waiting in public lobbies, for the homepage line.
 *
 * Counts a seated player only while presence reports them online, or before
 * their first heartbeat lands (no presence entry yet), so closed or abandoned
 * tabs do not inflate the number. It deliberately reads no clock: a
 * Date.now() read would make every execution unique and defeat the query
 * cache. The cost is that a player who switched tabs while waiting drops out
 * of the count until they come back (placement still treats them as live for
 * PLACEMENT_RECENT_MS).
 *
 * No per-user args, so one cached execution serves every homepage. It re-runs
 * when a public lobby or its players change, or when presence records an
 * online/offline transition in one of those rooms (steady-state heartbeats
 * write nothing).
 */
export const waitingCount = query({
  args: {},
  handler: async (ctx) => {
    const lobbies = await ctx.db
      .query("rooms")
      .withIndex("by_public_phase", (q) => q.eq("isPublic", true).eq("phase", "lobby"))
      .take(MAX_OPEN_ROOMS_SCANNED);
    let waiting = 0;
    for (const room of lobbies) {
      const players = await ctx.db
        .query("players")
        .withIndex("by_room", (q) => q.eq("roomCode", room.code))
        .take(QUICK_PLAY_CAP);
      if (players.length === 0) continue;
      const byUser = await presenceByUser(ctx, room.code);
      for (const p of players) {
        const entry = byUser.get(p.playerId);
        if (!entry || entry.online) waiting++;
      }
    }
    return { waiting };
  },
});

/** Toggle the caller's "Start now" vote. Unanimous (2+ players) starts the game. */
export const voteStart = mutation({
  args: { code: v.string(), playerId: v.string(), connectionId: v.string(), vote: v.optional(v.boolean()) },
  handler: async (ctx, { code, playerId, connectionId, vote }) => {
    const found = await publicRoomAndPlayer(ctx, code, playerId, connectionId);
    if ("error" in found) return { success: false, message: found.error } as const;
    const { room, player } = found;
    if (room.phase !== "lobby") return { success: false, message: "The game already started" } as const;

    const want = vote ?? true;
    const current = room.startVotes ?? [];
    const has = current.includes(player._id);
    if (want !== has) {
      const startVotes = want ? [...current, player._id] : current.filter((id) => id !== player._id);
      await ctx.db.patch(room._id, { startVotes, lastActivityAt: now() });
      const fresh = (await ctx.db.get(room._id))!;
      await reconcileLobby(ctx, fresh, await getRoomPlayers(ctx, code), "refresh");
    }
    return { success: true, voted: want } as const;
  },
});

/** Accept or decline the 1v1 offer. Starts when both players accept. */
export const respondOneVOne = mutation({
  args: { code: v.string(), playerId: v.string(), connectionId: v.string(), accept: v.boolean() },
  handler: async (ctx, { code, playerId, connectionId, accept }) => {
    const found = await publicRoomAndPlayer(ctx, code, playerId, connectionId);
    if ("error" in found) return { success: false, message: found.error } as const;
    const { room, player } = found;
    if (room.phase !== "lobby" || room.oneVOneOffered !== true) {
      return { success: false, message: "No 1v1 offer is open" } as const;
    }

    if (!accept) {
      // Withdraw the offer for both and ask again later.
      const offerAt = now() + ONE_V_ONE_OFFER_MS;
      await ctx.db.patch(room._id, {
        oneVOneOffered: false,
        oneVOneAccepts: [],
        oneVOneOfferAt: offerAt,
        lastActivityAt: now(),
      });
      await ctx.scheduler.runAfter(ONE_V_ONE_OFFER_MS, internal.quickPlay.fireOneVOneOffer, { code, offerAt });
      return { success: true, accepted: false } as const;
    }

    const accepts = room.oneVOneAccepts ?? [];
    if (!accepts.includes(player._id)) {
      await ctx.db.patch(room._id, { oneVOneAccepts: [...accepts, player._id], lastActivityAt: now() });
      const fresh = (await ctx.db.get(room._id))!;
      await reconcileLobby(ctx, fresh, await getRoomPlayers(ctx, code), "refresh");
    }
    return { success: true, accepted: true } as const;
  },
});

/**
 * Vote to remove a player from a public room (any phase). A majority of the
 * other players removes them, and they are never matched back into the room.
 * Needs 3+ players: with 2, leaving is the remedy.
 *
 * Votes are anonymous: the result and getRoomByCode carry only the target's
 * tally ({ votes, needed }), never who voted.
 */
export const voteKick = mutation({
  args: {
    code: v.string(),
    playerId: v.string(),
    connectionId: v.string(),
    targetPlayerDocId: v.id("players"),
  },
  handler: async (ctx, { code, playerId, connectionId, targetPlayerDocId }) => {
    const found = await publicRoomAndPlayer(ctx, code, playerId, connectionId);
    if ("error" in found) return { success: false, message: found.error } as const;
    const { room, player } = found;
    if (player._id === targetPlayerDocId) return { success: false, message: "You cannot kick yourself" } as const;

    const players = await getRoomPlayers(ctx, code);
    const target = players.find((p) => p._id === targetPlayerDocId);
    if (!target) return { success: false, message: "Player not found" } as const;
    if (players.length < 3) return { success: false, message: "Kick votes need at least 3 players" } as const;

    const seated = new Set<string>(players.map((p) => p._id));
    const votes = liveKickVotes(room.kickVotes, seated);
    const entry = votes.find((kv) => kv.targetId === targetPlayerDocId);
    const voterIds: Id<"players">[] = entry ? entry.voterIds : [];
    const needed = kickVotesNeeded(players.length);
    if (voterIds.includes(player._id)) {
      return { success: true, kicked: false, votes: voterIds.length, needed } as const;
    }
    const nextVoters = [...voterIds, player._id];

    if (nextVoters.length < needed) {
      const kickVotes = entry
        ? votes.map((kv) => (kv.targetId === targetPlayerDocId ? { ...kv, voterIds: nextVoters } : kv))
        : [...votes, { targetId: targetPlayerDocId, voterIds: nextVoters }];
      await ctx.db.patch(room._id, { kickVotes, lastActivityAt: now() });
      return { success: true, kicked: false, votes: nextVoters.length, needed } as const;
    }

    await removePublicPlayer(ctx, room, target);
    await ctx.db.patch(room._id, {
      kickedPlayerIds: [...(room.kickedPlayerIds ?? []), target.playerId],
      kickVotes: votes.filter((kv) => kv.targetId !== targetPlayerDocId),
      lastActivityAt: now(),
    });
    await settlePublicRoom(ctx, code, "leave");
    return { success: true, kicked: true, votes: nextVoters.length, needed } as const;
  },
});

/** The lobby countdown reached its stored fire time. */
export const fireCountdown = internalMutation({
  args: { code: v.string(), startsAt: v.number() },
  handler: async (ctx, { code, startsAt }) => {
    const room = await getRoom(ctx, code);
    if (!room || !room.isPublic || room.phase !== "lobby" || room.startsAt !== startsAt) return;
    const present = await dropKnownOffline(ctx, room, await getRoomPlayers(ctx, code));
    if (present.length >= COUNTDOWN_MIN_PLAYERS) {
      await startPublicGame(ctx, room, present, "countdown");
    } else {
      await settlePublicRoom(ctx, code, "leave");
    }
  },
});

/** Two players have waited long enough: offer them a 1v1. */
export const fireOneVOneOffer = internalMutation({
  args: { code: v.string(), offerAt: v.number() },
  handler: async (ctx, { code, offerAt }) => {
    const room = await getRoom(ctx, code);
    if (!room || !room.isPublic || room.phase !== "lobby" || room.oneVOneOfferAt !== offerAt) return;
    const players = await getRoomPlayers(ctx, code);
    if (players.length !== 2) return;
    await ctx.db.patch(room._id, { oneVOneOffered: true, oneVOneOfferAt: undefined, oneVOneAccepts: [] });
    await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
      eventType: "quickplay_1v1_offered",
      metadata: { roomCode: code },
    });
  },
});

/**
 * A public-room tab closed (leaveGame with onClose) a few seconds ago. Release
 * the seat unless the page came back since (resumeSeat or a rejoin cleared or
 * replaced closingAt).
 */
export const leaveAfterClose = internalMutation({
  args: { code: v.string(), playerId: v.string(), closingAt: v.number() },
  handler: async (ctx, { code, playerId, closingAt }) => {
    const room = await getRoom(ctx, code);
    if (!room || !room.isPublic) return;
    const player = await ctx.db
      .query("players")
      .withIndex("by_player", (q) => q.eq("playerId", playerId).eq("roomCode", code))
      .unique();
    if (!player || player.closingAt !== closingAt) return;
    await leavePublicRoom(ctx, room, player);
  },
});

/**
 * The page is (still or again) open: cancel a pending close-leave. Called by
 * the client when a game route mounts and when a page returns from the
 * back/forward cache. Writes only when a close is pending.
 */
export const resumeSeat = mutation({
  args: { code: v.string(), playerId: v.string(), connectionId: v.string() },
  handler: async (ctx, { code, playerId, connectionId }) => {
    const found = await publicRoomAndPlayer(ctx, code, playerId, connectionId);
    if ("error" in found) return { success: false, message: found.error } as const;
    if (found.player.closingAt !== undefined) {
      await ctx.db.patch(found.player._id, { closingAt: undefined });
    }
    return { success: true } as const;
  },
});
