import { CURATED_PROMPTS } from "./promptPacks";

/**
 * Quick Play (public, hostless) room rules. Plain constants with no imports
 * from game modules, so flow.ts and publicRooms.ts can both depend on them.
 */

/** Seats in a Quick Play room. */
export const QUICK_PLAY_CAP = 6;
/** Players needed before the start countdown arms. */
export const COUNTDOWN_MIN_PLAYERS = 3;
/** Countdown length once armed. */
export const COUNTDOWN_MS = 30_000;
/** Each join while armed pushes the start back by up to this much... */
export const COUNTDOWN_EXTEND_MS = 10_000;
/** ...but never past this long after the countdown armed. */
export const COUNTDOWN_MAX_MS = 60_000;
/** With exactly two players, offer a 1v1 after this long. */
export const ONE_V_ONE_OFFER_MS = 60_000;
/** Results screen auto-advances to the next round after this long. */
export const AUTO_ADVANCE_MS = 8_000;
/** Game over auto-rematches after this long; empty seats refill meanwhile. */
export const AUTO_REMATCH_MS = 15_000;
/** A lobby whose countdown fires sooner than this is not offered to joiners. */
export const JOIN_START_MARGIN_MS = 1_000;
/** A rematch firing sooner than this is not offered to joiners. */
export const JOIN_REMATCH_MARGIN_MS = 3_000;
/**
 * A waiting player (lobby, or game over before the rematch) the presence
 * component has reported offline for longer than this is treated as gone:
 * dropped when the room's game launches, and removed by the cleanup cron
 * (instead of the private-room grace window). Presence reports a hidden tab
 * as offline at once, so this must comfortably cover someone who switched
 * tabs while waiting for a match.
 */
export const PUBLIC_WAITING_TIMEOUT_MS = 3 * 60 * 1000;
/**
 * In a running Quick Play game, a player the presence component has reported
 * offline for longer than this is no longer waited on: "everyone submitted"
 * and "everyone rated" are judged without them, so the game moves on instead
 * of running out each timer. Long enough to cover a page refresh or a quick
 * tab switch (presence flips a hidden or closed tab offline at once).
 */
export const PUBLIC_IN_GAME_GRACE_MS = 45_000;
/**
 * Placement treats a waiting player as live when presence reports them online,
 * or reported them offline (or saw them join) less than this long ago. A room
 * with no live player is not offered to newcomers, so a lobby of closed tabs
 * the cleanup cron has not swept yet never strands someone.
 */
export const PLACEMENT_RECENT_MS = 60_000;
/**
 * A seated player with no presence entry (never heartbeated) stops counting
 * after this long: placement skips them and a launch drops them. A real
 * client's first heartbeat lands within a second or two of joining, so this
 * only catches seats that were joined by something that is not a page
 * (e.g. a script calling quickPlay.join in a loop).
 */
export const NO_HEARTBEAT_GRACE_MS = 20_000;
/** At most this many Quick Play joins per player id, and per visitor id... */
export const JOIN_RATE_LIMIT = 6;
/** ...within this window. Rejoining an existing seat is not counted. */
export const JOIN_RATE_WINDOW_MS = 60_000;
/**
 * A tab that closes calls leaveGame with onClose. A public seat is then
 * released after this delay unless the page came back and called
 * quickPlay.resumeSeat (a reload fires the same pagehide event as a close,
 * and should not cost the seat).
 */
export const CLOSE_LEAVE_DELAY_MS = 5_000;
/**
 * A player in a running Quick Play game the presence component has reported
 * offline for longer than this is removed by the cleanup cron (instead of the
 * private-room grace window).
 */
export const PUBLIC_IN_GAME_OFFLINE_MS = 90_000;

/** Fixed settings of every Quick Play room. */
export function quickPlaySettings() {
  return {
    numberOfRounds: 3,
    roundLength: 60,
    snippetDuration: 30,
    selectedPrompts: [...CURATED_PROMPTS],
    enablePromptVoting: true,
    anonymousMode: false,
    hostPro: false,
  };
}

const NAME_ADJECTIVES = [
  "Velvet", "Neon", "Golden", "Midnight", "Electric", "Cosmic", "Lunar",
  "Crystal", "Funky", "Mellow", "Silver", "Hazy", "Lucky", "Smooth", "Sonic",
  "Stellar", "Sunny", "Wild", "Retro", "Analog", "Groovy", "Breezy", "Dusty",
  "Fuzzy", "Jazzy", "Crimson", "Indigo", "Mystic", "Rapid", "Static",
];

const NAME_NOUNS = [
  "Bassline", "Chorus", "Riff", "Tempo", "Falsetto", "Anthem", "Encore",
  "Remix", "Sample", "Bridge", "Hook", "Groove", "Ballad", "Mixtape",
  "Cassette", "Turntable", "Synth", "Snare", "Backbeat", "Crescendo",
  "Harmony", "Melody", "Verse", "Banger", "Jam", "Loop", "Cadence", "Octave",
  "Overture", "Playlist", "Vinyl", "Subwoofer", "Metronome", "Tambourine",
];

/**
 * A fun display name ("Velvet Bassline") not already used in the room.
 * `random` is injectable for tests.
 */
export function generateFunName(taken: Iterable<string>, random: () => number = Math.random): string {
  const used = new Set(Array.from(taken, (n) => n.toLowerCase()));
  const pick = (list: string[]) => list[Math.floor(random() * list.length)] ?? list[0];
  for (let i = 0; i < 25; i++) {
    const name = `${pick(NAME_ADJECTIVES)} ${pick(NAME_NOUNS)}`;
    if (!used.has(name.toLowerCase())) return name;
  }
  const base = `${pick(NAME_ADJECTIVES)} ${pick(NAME_NOUNS)}`;
  for (let n = 2; ; n++) {
    const name = `${base} ${n}`;
    if (!used.has(name.toLowerCase())) return name;
  }
}

export const NAME_WORDS = { adjectives: NAME_ADJECTIVES, nouns: NAME_NOUNS };
