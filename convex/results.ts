import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { readVoterAwards } from "./game/flow";
import { containsHateSpeech } from "./game/contentFilter";

/**
 * Shared results: a saved copy of a finished game that anyone with its link
 * can open, after the room itself is gone.
 *
 * A snapshot is built by the server from its own records when a player in
 * the finished game asks for the link; the client sends no content. It leaves
 * out everything that could reach back into a live room: the room code, the
 * players' ids and the submission ids are replaced by keys that mean nothing
 * outside the snapshot.
 */

export const SHARE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SHARE_ID_LENGTH = 12;
const SHARE_ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no look-alikes
const SHARE_ID_RE = /^[a-z0-9]{12}$/;
const PRUNE_BATCH = 100;
const MAX_ROUNDS = 40;
const MAX_SONGS_PER_ROUND = 60;

function makeShareId(): string {
  // Rejection sampling: a plain modulo would favor the first letters.
  const limit = 256 - (256 % SHARE_ID_ALPHABET.length);
  let id = "";
  while (id.length < SHARE_ID_LENGTH) {
    const bytes = new Uint8Array(SHARE_ID_LENGTH * 2);
    crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b < limit && id.length < SHARE_ID_LENGTH) id += SHARE_ID_ALPHABET[b % SHARE_ID_ALPHABET.length];
    }
  }
  return id;
}

/**
 * Song details reach the server from the submitting player's client and are
 * not checked there: inside a room only the players see them. A shared page
 * is public, so they are cleaned on the way into a snapshot.
 */
const MAX_SONG_TEXT = 120;
const MAX_PROMPT_TEXT = 200;
const REMOVED_TEXT = "[removed]";
// Cover images are accepted only in the URL shapes the music catalogs serve
// thumbnails in. This cannot prove an image is a song cover (anyone can
// upload a video, and its thumbnail lives on the same host), but it limits a
// public page to images those catalogs host and moderate, with no query
// string or other extras riding along.
const COVER_SHAPES: Array<{ host: RegExp; path: RegExp }> = [
  // YouTube thumbnails: /vi/<11 char id>/<name>.jpg
  { host: /^i\d?\.ytimg\.com$/, path: /^\/vi(_webp)?\/[A-Za-z0-9_-]{11}\/[a-z0-9_]{1,24}\.(jpg|webp)$/ },
  // iTunes artwork
  { host: /^[a-z0-9-]{1,40}\.mzstatic\.com$/, path: /^\/image\/thumb\/[A-Za-z0-9/._-]{1,300}\.(jpg|jpeg|png|webp)$/ },
  // Deezer covers
  { host: /^[a-z0-9-]{1,40}\.dzcdn\.net$/, path: /^\/images\/(cover|artist)\/[A-Za-z0-9/._-]{1,200}\.(jpg|jpeg|png)$/ },
];
const MAX_COVER_URL = 500;

// A high or low surrogate without its partner, and control characters.
const BROKEN_TEXT_RE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]|[\u0000-\u001F\u007F]/g;

/**
 * Text fit for a public page: bounded before any work is done on it, cut on
 * whole characters (never through an emoji), whitespace collapsed, and
 * replaced outright when the name filter rejects it.
 */
export function publicText(text: string, max = MAX_SONG_TEXT): string {
  // A code point is at most 2 UTF-16 units; the slack covers runs of spaces.
  const head = text.slice(0, max * 8).replace(/\s+/g, " ").replace(BROKEN_TEXT_RE, "").trim();
  const clean = Array.from(head).slice(0, max).join("").trim();
  return containsHateSpeech(clean) ? REMOVED_TEXT : clean;
}

/** The cover URL when it has a catalog thumbnail's exact shape over https, else "". */
export function publicCover(url: string): string {
  if (typeof url !== "string" || url.length > MAX_COVER_URL) return "";
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" || u.username || u.password || u.port || u.search || u.hash) return "";
    const ok = COVER_SHAPES.some((shape) => shape.host.test(u.hostname) && shape.path.test(u.pathname));
    return ok ? `https://${u.hostname}${u.pathname}` : "";
  } catch {
    return "";
  }
}

/**
 * The reel seed the final screen derives for a game (hashStr in the client's
 * resultsModel.js, same algorithm and same input). Stored so the shared page
 * picks the same awards the players saw.
 */
export function reelSeed(code: string, rounds: Array<{ winnerSongId?: string; round: number }>): number {
  const str = `${code}|${rounds.map((r) => r.winnerSongId || r.round).join("|")}`;
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i += 1) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Returns the link id for this finished game's results, creating the snapshot
 * the first time anyone in the game asks. One snapshot per game: later calls,
 * from any player, get the same id.
 */
export const share = mutation({
  args: { code: v.string(), playerId: v.string(), connectionId: v.string() },
  handler: async (ctx, { code, playerId, connectionId }) => {
    const room = await ctx.db
      .query("rooms")
      .withIndex("by_code", (q) => q.eq("code", code))
      .unique();
    if (!room || room.phase !== "gameOver") {
      return { success: false, message: "This game's results are no longer available." } as const;
    }
    const players = await ctx.db
      .query("players")
      .withIndex("by_room", (q) => q.eq("roomCode", code))
      .collect();
    const me = players.find((p) => p.playerId === playerId);
    if (!me || me.connectionId !== connectionId) {
      return { success: false, message: "Only players in this game can share its results." } as const;
    }

    const gameEpoch = room.gameEpoch ?? 0;
    const existing = await ctx.db
      .query("sharedResults")
      .withIndex("by_room_and_epoch", (q) => q.eq("roomCode", code).eq("gameEpoch", gameEpoch))
      .first();
    if (existing) return { success: true, shareId: existing.shareId } as const;

    const roundRows = await ctx.db
      .query("roundResults")
      .withIndex("by_room_round", (q) => q.eq("roomCode", code))
      .collect();
    if (roundRows.length === 0) {
      return { success: false, message: "This game has no results to share." } as const;
    }
    // Far above any real game (rounds are capped by the settings, players by
    // the room). Keeps a snapshot comfortably inside one document.
    if (roundRows.length > MAX_ROUNDS || roundRows.some((rr) => rr.results.length > MAX_SONGS_PER_ROUND)) {
      return { success: false, message: "This game is too large to share." } as const;
    }

    // Stable keys in place of player ids. Players who left mid-game still
    // appear in the rounds they played.
    const names = new Map(players.map((p) => [p.playerId, p.name]));
    const keys = new Map<string, string>();
    const keyOf = (id: string) => {
      let key = keys.get(id);
      if (!key) {
        key = `p${keys.size + 1}`;
        keys.set(id, key);
      }
      return key;
    };
    const songKeys = new Map<string, string>();
    const rounds = roundRows.map((rr) => {
      const songs = rr.results.map((song, i) => {
        const songKey = `r${rr.round}s${i + 1}`;
        songKeys.set(song.songId, songKey);
        return {
          songId: songKey,
          playerKey: keyOf(song.playerId),
          name: publicText(song.name),
          artist: publicText(song.artist),
          albumCover: publicCover(song.albumCover),
          totalRecords: song.totalRecords,
        };
      });
      return {
        round: rr.round,
        ...(rr.prompt ? { prompt: publicText(rr.prompt, MAX_PROMPT_TEXT) } : {}),
        ...(rr.winnerSongId ? { winnerSongId: songKeys.get(rr.winnerSongId) ?? "" } : {}),
        songs,
      };
    });
    const voterAwards = (await readVoterAwards(ctx, code)).map((a) => ({
      voterKey: keyOf(a.voterId),
      avgGiven: a.avgGiven,
      count: a.count,
      kingmakerHits: a.kingmakerHits,
    }));
    const snapshotPlayers = [...keys.entries()].map(([id, key]) => ({
      key,
      name: publicText(names.get(id) ?? "Unknown Player", 50),
    }));

    const createdAt = Date.now();
    const shareId = makeShareId();
    await ctx.db.insert("sharedResults", {
      shareId,
      roomCode: code,
      gameEpoch,
      createdAt,
      expiresAt: createdAt + SHARE_TTL_MS,
      seed: reelSeed(code, roundRows),
      players: snapshotPlayers,
      rounds,
      voterAwards,
    });
    return { success: true, shareId } as const;
  },
});

/**
 * A shared game's results in the shapes the final screen already reads
 * (getAllRoundResults, getPlayers, getVoterAwards), or null when the link is
 * unknown or has expired. Never returns the room code.
 */
export const get = query({
  args: { shareId: v.string() },
  handler: async (ctx, { shareId }) => {
    if (!SHARE_ID_RE.test(shareId)) return null;
    const row = await ctx.db
      .query("sharedResults")
      .withIndex("by_shareId", (q) => q.eq("shareId", shareId))
      .unique();
    if (!row || row.expiresAt <= Date.now()) return null;
    const nameOf = new Map(row.players.map((p) => [p.key, p.name]));
    return {
      seed: row.seed,
      createdAt: row.createdAt,
      players: row.players.map((p) => ({ playerId: p.key, name: p.name })),
      rounds: row.rounds.map((r) => ({
        round: r.round,
        prompt: r.prompt,
        winnerSongId: r.winnerSongId,
        songs: r.songs.map((s) => ({
          songId: s.songId,
          // Both forms, as getAllRoundResults returns them: the award
          // computation reads playerId, the standings read player.
          playerId: s.playerKey,
          name: s.name,
          artist: s.artist,
          albumCover: s.albumCover,
          totalRecords: s.totalRecords,
          isWinner: s.songId === r.winnerSongId,
          player: { id: s.playerKey, name: nameOf.get(s.playerKey) ?? "Unknown Player" },
        })),
      })),
      voterAwards: row.voterAwards.map((a) => ({
        voterId: a.voterKey,
        avgGiven: a.avgGiven,
        count: a.count,
        kingmakerHits: a.kingmakerHits,
      })),
    };
  },
});

/** Cron: deletes snapshots past their expiry, a bounded batch per run. */
export const pruneExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    const expired = await ctx.db
      .query("sharedResults")
      .withIndex("by_expiresAt", (q) => q.lt("expiresAt", Date.now()))
      .take(PRUNE_BATCH);
    for (const row of expired) await ctx.db.delete(row._id);
    return { deleted: expired.length };
  },
});
