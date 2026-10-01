import { v } from "convex/values";
import { internalMutation, mutation, query, type MutationCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { containsHateSpeech } from "./game/contentFilter";
import { cleanVisitorId, recordVisitorPlayed } from "./siteStats";
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
      await ctx.db.patch(m._id, { connectionId, connectedAt: now(), isActive: true });
      await ctx.db.patch(room._id, { lastActivityAt: now() });
      return { success: true, code: room.code, name: m.name, playerId, rejoined: true } as const;
    }

    // Placement: the open room with the most players (oldest on a tie).
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
    let best: { room: Room; players: Player[] } | null = null;
    for (const room of open) {
      if (!acceptsNewPlayers(room, playerId, t)) continue;
      const players = await getRoomPlayers(ctx, room.code);
      if (players.length >= QUICK_PLAY_CAP) continue;
      // The membership scan above is bounded, so a playerId seated in many
      // rooms can slip past it. Never seat a playerId twice in one room.
      if (players.some((p) => p.playerId === playerId)) continue;
      if (
        !best ||
        players.length > best.players.length ||
        (players.length === best.players.length && room._creationTime < best.room._creationTime)
      ) {
        best = { room, players };
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
 * Players waiting in public lobbies, for the homepage line. Reads only the
 * public-lobby index range and those rooms' players (no clock reads, no
 * per-user args), so one cached execution serves every homepage and it
 * re-runs only when a public lobby changes.
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
      waiting += players.length;
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
    const { room } = found;
    if (room.phase !== "lobby") return { success: false, message: "The game already started" } as const;

    const want = vote ?? true;
    const current = room.startVotes ?? [];
    const has = current.includes(playerId);
    if (want !== has) {
      const startVotes = want ? [...current, playerId] : current.filter((id) => id !== playerId);
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
    const { room } = found;
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
    if (!accepts.includes(playerId)) {
      await ctx.db.patch(room._id, { oneVOneAccepts: [...accepts, playerId], lastActivityAt: now() });
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
 */
export const voteKick = mutation({
  args: { code: v.string(), playerId: v.string(), connectionId: v.string(), targetPlayerId: v.string() },
  handler: async (ctx, { code, playerId, connectionId, targetPlayerId }) => {
    const found = await publicRoomAndPlayer(ctx, code, playerId, connectionId);
    if ("error" in found) return { success: false, message: found.error } as const;
    const { room } = found;
    if (playerId === targetPlayerId) return { success: false, message: "You cannot kick yourself" } as const;

    const players = await getRoomPlayers(ctx, code);
    const target = players.find((p) => p.playerId === targetPlayerId);
    if (!target) return { success: false, message: "Player not found" } as const;
    if (players.length < 3) return { success: false, message: "Kick votes need at least 3 players" } as const;

    const ids = new Set(players.map((p) => p.playerId));
    const votes = liveKickVotes(room.kickVotes, ids);
    const entry = votes.find((kv) => kv.targetPlayerId === targetPlayerId);
    const voterIds = entry ? entry.voterIds : [];
    if (voterIds.includes(playerId)) {
      return { success: true, kicked: false, votes: voterIds.length, needed: kickVotesNeeded(players.length) } as const;
    }
    const nextVoters = [...voterIds, playerId];
    const needed = kickVotesNeeded(players.length);

    if (nextVoters.length < needed) {
      const kickVotes = entry
        ? votes.map((kv) => (kv.targetPlayerId === targetPlayerId ? { ...kv, voterIds: nextVoters } : kv))
        : [...votes, { targetPlayerId, voterIds: nextVoters }];
      await ctx.db.patch(room._id, { kickVotes, lastActivityAt: now() });
      return { success: true, kicked: false, votes: nextVoters.length, needed } as const;
    }

    await removePublicPlayer(ctx, room, target);
    await ctx.db.patch(room._id, {
      kickedPlayerIds: [...(room.kickedPlayerIds ?? []), targetPlayerId],
      kickVotes: votes.filter((kv) => kv.targetPlayerId !== targetPlayerId),
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
