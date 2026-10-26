import { v } from "convex/values";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
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
// screen offline after 2.5x this without a heartbeat (~112 s), which covers a
// client heartbeating every 30-60 s with room for a missed beat.
export const SCREEN_HEARTBEAT_INTERVAL_MS = 45_000;

// Online screens one room may hold. A new screen past this is ignored, which
// bounds the component writes an anonymous caller can cause per room.
export const MAX_SCREENS_PER_ROOM = 4;

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

/**
 * Keeps a screen marked online for a room. Safe to call anonymously: bad
 * shapes, unknown rooms and a full screen roster are silent no-ops
 * (`{ ok: false }`). Never creates a player and never writes a game document.
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
    const online = await presence.listRoom(ctx, key, true, MAX_SCREENS_PER_ROOM + 1);
    if (online.length >= MAX_SCREENS_PER_ROOM && !online.some((p) => p.userId === screenId)) {
      return { ok: false } as const;
    }

    // One session per screen per room; the sessionId is unique per
    // (room, screen) pair as the component requires.
    await presence.heartbeat(ctx, key, screenId, `${roomCode}:${screenId}`, SCREEN_HEARTBEAT_INTERVAL_MS);
    return { ok: true } as const;
  },
});

/** Best-effort removal when the screen page is hidden or closed. */
export const leave = mutation({
  args: { code: v.string(), screenId: v.string() },
  handler: async (ctx, { code, screenId }) => {
    const roomCode = normalizeCode(code);
    if (!roomCode || !SCREEN_ID_RE.test(screenId)) return null;
    const key = screenRoomKey(roomCode);
    const entries = await presence.listRoom(ctx, key, false, MAX_SCREENS_PER_ROOM + 1);
    if (!entries.some((p) => p.userId === screenId)) return null;
    await presence.removeRoomUser(ctx, key, screenId);
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
