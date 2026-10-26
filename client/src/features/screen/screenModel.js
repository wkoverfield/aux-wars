/**
 * Pure helpers for the big screen (/screen/:code): a display-only view of a
 * room for a TV or laptop. It reads the room by code and never takes a seat.
 */

/**
 * Which view the screen shows for a getRoomByCode result.
 * - "loading": the query has not answered yet
 * - "missing": no such room (never existed, ended, or swept)
 * - "unavailable": a Quick Play room; big screens are for private rooms
 * - otherwise the room phase's view: "lobby", "prompt", "selection",
 *   "rating" (or "tallying" while the rating query catches up), "results",
 *   "gameOver"
 *
 * @param {Object|null|undefined} roomResult - getRoomByCode's answer
 * @param {Object|null|undefined} ratingSong - getCurrentRatingSong's answer
 */
export function screenViewFor(roomResult, ratingSong) {
  if (roomResult === undefined) return "loading";
  if (roomResult === null) return "missing";
  const room = roomResult.room || roomResult;
  if (room?.isPublic) return "unavailable";
  switch (room?.phase) {
    case "lobby":
      return "lobby";
    case "promptVoting":
      return "prompt";
    case "songSelection":
    case "roundStart":
      return "selection";
    case "rating":
      return ratingSong ? "rating" : "tallying";
    case "results":
      return "results";
    case "gameOver":
      return "gameOver";
    default:
      return "loading";
  }
}

/**
 * Players split by whether they have picked a song this round. Names only:
 * the screen never shows which song anyone picked.
 */
export function pickStatus(players, round) {
  const picked = [];
  const waiting = [];
  for (const player of players || []) {
    if (player?.isWaiting) continue;
    const done = Array.isArray(player?.submittedRounds) && player.submittedRounds.includes(round);
    (done ? picked : waiting).push(player);
  }
  return { picked, waiting };
}

/**
 * Votes in on the song being rated, out of the players who can vote on it
 * (everyone but the person who picked it).
 */
export function ratingVotes(status) {
  const total = Math.max(0, (status?.total || 0) - 1);
  return { submitted: Math.min(status?.submitted || 0, total), total };
}

/** The screen is laid out on a fixed 16:9 stage and scaled to fit the display. */
export const STAGE_WIDTH = 1280;
export const STAGE_HEIGHT = 720;

/** Scale that fits the stage inside a viewport, letterboxed. */
export function stageScale(width, height) {
  if (!width || !height) return 1;
  return Math.min(width / STAGE_WIDTH, height / STAGE_HEIGHT);
}

/** Who picked the song, or null when the room hides it (same rule as phones). */
export function submitterLabel(song, anonymousMode) {
  if (anonymousMode) return null;
  return song?.player?.name || null;
}

/** The screen page for a room, as a full URL. */
export function screenUrl(code, origin = typeof window === "undefined" ? "" : window.location.origin) {
  return `${origin}/screen/${code}`;
}

/** The screen URL as people type it on a TV: no scheme, no "www.". */
export function screenUrlLabel(code, origin = typeof window === "undefined" ? "" : window.location.origin) {
  return screenUrl(code, origin).replace(/^https?:\/\//, "").replace(/^www\./, "");
}

/** The join link the screen's QR code opens, tagged so the join is counted as a screen join. */
export function screenJoinUrl(code, origin = typeof window === "undefined" ? "" : window.location.origin) {
  return `${origin}/lobby/${code}?src=screen`;
}

/** How a join from this URL is counted: "screen" from the big screen's QR, else "link". */
export function joinSourceFrom(search) {
  try {
    return new URLSearchParams(search || "").get("src") === "screen" ? "screen" : "link";
  } catch {
    return "link";
  }
}

/** Reads a sessionStorage value, or null when storage is unavailable. */
export function readSession(key, storage = globalThis.sessionStorage) {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Writes a sessionStorage value; does nothing when storage is unavailable. */
export function writeSession(key, value, storage = globalThis.sessionStorage) {
  try {
    if (value === null) storage?.removeItem(key);
    else storage?.setItem(key, value);
  } catch {
    // Private mode or blocked storage: the value just is not remembered.
  }
}

const SCREEN_ID_KEY = "auxwars:screenId";

/** This tab's screen id, kept for the tab's life so a reload is the same screen. */
export function screenIdFor(storage = globalThis.sessionStorage, makeId = () => globalThis.crypto.randomUUID()) {
  const existing = readSession(SCREEN_ID_KEY, storage);
  if (existing) return existing;
  const id = makeId();
  writeSession(SCREEN_ID_KEY, id, storage);
  return id;
}

/** sessionStorage key for a phone's "Play on this phone" choice in a room. */
export function phoneAudioKey(code) {
  return `auxwars:playOnPhone:${code}`;
}

/** Body of the best-effort leave beacon a closing screen sends. */
export function screenLeaveBeaconBody({ code, screenId }) {
  return JSON.stringify({ path: "screens:leave", args: { code, screenId }, format: "json" });
}
