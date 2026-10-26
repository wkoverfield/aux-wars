import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { presence } from "./presence";

// Shared screens (a TV or laptop showing /screen/:code) are display-only and
// private-room only: a public (Quick Play) room never registers one, so a
// stranger cannot hold songs or mute phones for matched players. They
// are never players: nothing here reads or writes `rooms` or `players`
// documents beyond a read of the room to confirm it exists, and nothing counts
// toward caps, joins or seats.
//
// Screen presence lives in the @convex-dev/presence component under its own
// room key, `screen:<CODE>`, so screens never appear in player presence
// (which is keyed by the bare room code). Room codes are [A-Z0-9]{6}, so the
// two key spaces cannot collide. A steady heartbeat only refreshes the
// component's session timeout; the component's `presence` rows (the only
// thing screenAttached reads) change on online/offline transitions alone.

const ROOM_CODE_RE = /^[A-Z0-9]{6}$/;
const SCREEN_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

// Fixed server-side: the client does not choose it. The component marks a
// screen offline after 2.5x this without a heartbeat (50 s), so phones get
// their audio back soon after a screen drops off. The client heartbeats at
// this interval. A steady heartbeat rewrites only the component's session
// timeout row, never the presence row screenAttached reads.
export const SCREEN_HEARTBEAT_INTERVAL_MS = 20_000;

// Online screens one room may hold. A new screen past this is ignored, which
// bounds the component writes an anonymous caller can cause per room.
export const MAX_SCREENS_PER_ROOM = 4;

// Screens a room may ever know (online or offline rows). leave keeps a row
// offline, so without this an attach/leave loop with fresh ids would grow
// rows and screen_opened events without bound. Known screens keep working.
export const MAX_KNOWN_SCREENS_PER_ROOM = 12;

/** Presence-component room key for a room's screens. */
export function screenRoomKey(code: string): string {
  return `screen:${code}`;
}

function normalizeCode(code: string): string | null {
  const c = code.trim().toUpperCase();
  return ROOM_CODE_RE.test(c) ? c : null;
}

/**
 * True while at least one screen for the room is online. Reads only the
 * first online presence row under the screen key, so it changes (and
 * invalidates readers) only on a screen's online/offline transition.
 */
export async function isScreenAttached(ctx: QueryCtx | MutationCtx, code: string): Promise<boolean> {
  const online = await presence.listRoom(ctx, screenRoomKey(code), true, 1);
  return online.length > 0;
}

/** Clears every screen presence row for a room (room deletion paths). */
export async function removeScreenPresence(ctx: MutationCtx, code: string): Promise<void> {
  await presence.removeRoom(ctx, screenRoomKey(code));
}

/** Whether this screen has a presence row (online or offline) for the room. */
async function screenKnown(ctx: MutationCtx, key: string, screenId: string): Promise<boolean> {
  const rows = await presence.listUser(ctx, screenId, false, 50);
  return rows.some((r) => r.roomId === key);
}

/**
 * Keeps a screen marked online for a room. Safe to call anonymously: bad
 * shapes, unknown and public rooms, a full screen roster, and a new screen in
 * a locked room or a room that has already seen MAX_KNOWN_SCREENS_PER_ROOM
 * screens are silent no-ops (`{ ok: false }`). A screen already known
 * to a room keeps working after the room is locked. Never creates a player
 * and never writes a game document. Logs screen_opened when a screen first
 * attaches to a room.
 */
export const heartbeat = mutation({
  args: { code: v.string(), screenId: v.string() },
  handler: async (ctx, { code, screenId }) => {
    const roomCode = normalizeCode(code);
    if (!roomCode || !SCREEN_ID_RE.test(screenId)) return { ok: false } as const;

    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", roomCode))
      .unique();
    if (!room || room.isPublic) return { ok: false } as const;

    const key = screenRoomKey(roomCode);
    const known = await screenKnown(ctx, key, screenId);
    // A locked room is sealed against a leaked code: no new screens.
    if (!known && room.locked) return { ok: false } as const;
    if (!known) {
      const all = await presence.listRoom(ctx, key, false, MAX_KNOWN_SCREENS_PER_ROOM + 1);
      if (all.length >= MAX_KNOWN_SCREENS_PER_ROOM) return { ok: false } as const;
    }
    const online = await presence.listRoom(ctx, key, true, MAX_SCREENS_PER_ROOM + 1);
    if (online.length >= MAX_SCREENS_PER_ROOM && !online.some((p) => p.userId === screenId)) {
      return { ok: false } as const;
    }

    // One session per screen per room; the sessionId is unique per
    // (room, screen) pair as the component requires.
    await presence.heartbeat(ctx, key, screenId, sessionIdFor(roomCode, screenId), SCREEN_HEARTBEAT_INTERVAL_MS);
    if (!known) {
      await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
        eventType: "screen_opened",
        metadata: { roomCode },
      });
    }
    return { ok: true } as const;
  },
});

function sessionIdFor(roomCode: string, screenId: string): string {
  return `${roomCode}:${screenId}`;
}

/**
 * Best-effort offline mark when the screen page is hidden or closed. The
 * presence row is kept (offline), so the screen stays known to the room: it
 * may come back after the room is locked, and its return is not a new
 * screen_opened.
 */
export const leave = mutation({
  args: { code: v.string(), screenId: v.string() },
  handler: async (ctx, { code, screenId }) => {
    const roomCode = normalizeCode(code);
    if (!roomCode || !SCREEN_ID_RE.test(screenId)) return null;
    const key = screenRoomKey(roomCode);
    const online = await presence.listRoom(ctx, key, true, MAX_SCREENS_PER_ROOM + 1);
    if (!online.some((p) => p.userId === screenId)) return null;
    // The component disconnects by session token, which heartbeat hands back
    // for the screen's existing (online) session.
    const { sessionToken } = await presence.heartbeat(
      ctx,
      key,
      screenId,
      sessionIdFor(roomCode, screenId),
      SCREEN_HEARTBEAT_INTERVAL_MS
    );
    await presence.disconnect(ctx, sessionToken);
    return null;
  },
});

/**
 * Whether any screen is attached to the room. Room-keyed; returns a boolean.
 * Always false for a public room, since heartbeat never registers a screen
 * there; the room doc is deliberately not read, so room writes do not re-run
 * this query.
 */
export const screenAttached = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const roomCode = normalizeCode(code);
    if (!roomCode) return false;
    return await isScreenAttached(ctx, roomCode);
  },
});
