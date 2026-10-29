/**
 * Permanent, anonymous song stats.
 *
 * Room data (submissions, ratings, roundResults) is deleted with the room, so
 * each finished round folds its songs into `songStats` here. One row per song
 * for every prompt combined (`prompt` undefined) plus one row per song per
 * curated prompt. Custom prompts count toward the combined row only; their
 * text is player-typed and is never stored. No player ids, names or room codes
 * are kept.
 *
 * Nothing reactive reads this table, so writes never invalidate a game query.
 */
import type { MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { CURATED_PROMPTS } from "./game/promptPacks";

const CURATED = new Set(CURATED_PROMPTS);
const MAX_SOURCES = 5;

// Titles and artists longer than this are not real catalog entries. Checked
// before any regex runs so player-supplied strings cannot make normalization
// slow enough to hit the mutation time limit.
const MAX_INPUT = 300;
// Bracket groups are found with one linear pattern, then tested against the
// keyword lists: a group holding video junk ("(Official Video)") or a featured
// artist ("(feat. X)", "[with X]") is dropped. Trailing unbracketed
// "feat. X" is dropped too.
const BRACKET = /\s*[([][^)\]]*[)\]]/g;
const JUNK_WORD = /\b(?:official|video|audio|lyrics?|visuali[sz]er|hd|hq|4k|mv|explicit|clean|remaster(?:ed)?)\b/i;
const FEAT_GROUP = /^\s*[([]\s*(?:feat|ft|featuring|with)\b/i;
const TRAILING_FEAT = /\s+(?:feat|ft|featuring)\.?\s.*$/i;
// Longest key we index; anything longer is not a real catalog title.
const MAX_KEY = 200;
const MAX_FIELD = 300;

function clean(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function cleanArtist(artist: string): string {
  return clean(
    artist
      .replace(/\s*-\s*topic$/i, "")
      .replace(/vevo$/i, "")
      .replace(/\s*official$/i, "")
  );
}

/**
 * Stable key for a song across sources: "artist|title", normalized so the
 * iTunes, Deezer and YouTube copies of one recording usually share a key.
 * Returns null for over-long input, an empty half, or a key too long to index.
 */
export function songKey(name: string, artist: string): string | null {
  if (name.length > MAX_INPUT || artist.length > MAX_INPUT) return null;
  let artistKey = cleanArtist(artist);
  let title = name
    .replace(BRACKET, (group) => (JUNK_WORD.test(group) || FEAT_GROUP.test(group) ? "" : group))
    .replace(TRAILING_FEAT, "");
  // YouTube titles are often "Artist - Title" under a channel name such as
  // "ArtistVEVO"; the title's artist is the cleaner of the two. Compare with
  // spaces removed because channel names usually have none.
  const dash = title.split(/\s+[-–—]\s+/);
  if (dash.length >= 2) {
    const titleArtist = cleanArtist(dash[0]);
    const squash = (s: string) => s.replace(/ /g, "");
    if (titleArtist && artistKey && (squash(artistKey).includes(squash(titleArtist)) || squash(titleArtist).includes(squash(artistKey)))) {
      artistKey = titleArtist;
      title = dash.slice(1).join(" ");
    }
  }
  const titleKey = clean(title);
  if (!artistKey || !titleKey) return null;
  const key = `${artistKey}|${titleKey}`;
  return key.length > MAX_KEY ? null : key;
}

const cap = (s: string, n = MAX_FIELD) => (s.length > n ? s.slice(0, n) : s);

type RoundSong = {
  submission: Doc<"submissions">;
  ratings: number[]; // raw rating values for this song, -1 included
  isWinner: boolean;
};

async function bump(
  ctx: MutationCtx,
  key: string,
  prompt: string | undefined,
  song: RoundSong,
  at: number
) {
  const { trackDetails, trackId } = song.submission;
  const valid = song.ratings.filter((r) => Number.isInteger(r) && r >= 1 && r <= 5);
  const existing = await ctx.db
    .query("songStats")
    .withIndex("by_song_prompt", (q) => q.eq("songKey", key).eq("prompt", prompt))
    .unique();

  if (!existing) {
    const hist = [0, 0, 0, 0, 0];
    for (const r of valid) hist[r - 1]++;
    await ctx.db.insert("songStats", {
      songKey: key,
      prompt,
      name: cap(trackDetails.name),
      artist: cap(trackDetails.artist),
      albumCover: cap(trackDetails.albumCover, 1000),
      picks: 1,
      wins: song.isWinner ? 1 : 0,
      ratingCount: valid.length,
      ratingSum: valid.reduce((s, r) => s + r, 0),
      ratingHist: hist,
      sources: [cap(trackId)],
      firstSeenAt: at,
      lastSeenAt: at,
    });
    return;
  }

  const hist = [...existing.ratingHist];
  for (const r of valid) hist[r - 1]++;
  const source = cap(trackId);
  const sources = existing.sources.includes(source) || existing.sources.length >= MAX_SOURCES
    ? existing.sources
    : [...existing.sources, source];
  await ctx.db.patch(existing._id, {
    picks: existing.picks + 1,
    wins: existing.wins + (song.isWinner ? 1 : 0),
    ratingCount: existing.ratingCount + valid.length,
    ratingSum: existing.ratingSum + valid.reduce((s, r) => s + r, 0),
    ratingHist: hist,
    sources,
    lastSeenAt: at,
  });
}

/** Folds one finished round into songStats. Call once per round. */
export async function recordRoundSongStats(
  ctx: MutationCtx,
  prompt: string | undefined,
  songs: RoundSong[],
  at: number
) {
  const curatedPrompt = prompt && CURATED.has(prompt) ? prompt : undefined;
  for (const song of songs) {
    const { name, artist } = song.submission.trackDetails;
    const key = songKey(name, artist);
    if (!key) continue;
    await bump(ctx, key, undefined, song, at);
    if (curatedPrompt) await bump(ctx, key, curatedPrompt, song, at);
  }
}
