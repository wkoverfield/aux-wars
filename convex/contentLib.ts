/**
 * Pure rules for the published content pages: publishing bars, slugs, ISO
 * week ids and the chart lists. No database access, so every rule here is
 * unit tested directly.
 */
import { isBlocked } from "./contentBlocklist";

// A song gets a page at this many ratings; an artist at this many picks
// across all of their songs (and at least one live song).
export const SONG_MIN_RATINGS = 50;
export const ARTIST_MIN_PICKS = 50;
// Songs with fewer picks are left out of the weekly baseline.
export const BASELINE_MIN_PICKS = 5;
// Highest rated and most divisive only rank songs with this many ratings.
export const RATED_MIN_RATINGS = 50;
export const CHART_SIZE = 25;
export const SHORT_CHART_SIZE = 10;
export const TOP_PROMPTS = 8;

export type SongTotals = {
  picks: number;
  wins: number;
  ratingCount: number;
  ratingSum: number;
  ratingHist: number[]; // counts of 1..5 ratings
};

export type ArtistTotals = { picks: number; ratingCount: number; ratingSum: number };

export const isSongCandidate = (t: Pick<SongTotals, "ratingCount">) =>
  t.ratingCount >= SONG_MIN_RATINGS;
export const isArtistCandidate = (t: Pick<ArtistTotals, "picks">) => t.picks >= ARTIST_MIN_PICKS;

/** The two halves of a song key ("artist|title"). */
export function splitSongKey(songKey: string): { artistKey: string; titleKey: string } {
  const bar = songKey.indexOf("|");
  return { artistKey: songKey.slice(0, bar), titleKey: songKey.slice(bar + 1) };
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Mean rating to two decimals, or null without ratings. */
export const averageOf = (ratingSum: number, ratingCount: number): number | null =>
  ratingCount > 0 ? round2(ratingSum / ratingCount) : null;

/**
 * How far a song's ratings sit from their mean: the population standard
 * deviation of its 1..5 ratings. 0 when every rating is the same, 2 when they
 * split evenly between 1 and 5.
 */
export function ratingSpread(hist: number[]): number {
  let count = 0;
  let sum = 0;
  for (let i = 0; i < 5; i++) {
    count += hist[i] ?? 0;
    sum += (hist[i] ?? 0) * (i + 1);
  }
  if (count === 0) return 0;
  const mean = sum / count;
  let squares = 0;
  for (let i = 0; i < 5; i++) squares += (hist[i] ?? 0) * (i + 1 - mean) ** 2;
  return Math.sqrt(squares / count);
}

/** The largest prompts by picks, largest first, ties by prompt text. */
export function topPrompts(picksByPrompt: Map<string, number> | undefined) {
  if (!picksByPrompt) return [];
  return [...picksByPrompt]
    .map(([prompt, picks]) => ({ prompt, picks }))
    .filter((p) => p.picks > 0)
    .sort((a, b) => b.picks - a.picks || (a.prompt < b.prompt ? -1 : 1))
    .slice(0, TOP_PROMPTS);
}

// --- Slugs ---

// A slug is used verbatim as a file name and a URL segment: only [a-z0-9-],
// never empty, at most MAX_SLUG characters including a collision suffix.
export const MAX_SLUG = 80;
const MAX_SLUG_BASE = 72;
const MAX_SLUG_INPUT = 300;
// A slug that would clash with a directory index file.
export const RESERVED_SLUGS = new Set(["index"]);

// Latin letters that NFKD does not split into a base letter and an accent.
const FOLD: Record<string, string> = {
  ß: "ss", æ: "ae", œ: "oe", ø: "o", đ: "d", ð: "d", þ: "th", ł: "l", ı: "i", ħ: "h",
};

/** ASCII words of the text joined by hyphens; "" when it has no Latin letters or digits. */
export function slugPart(text: string): string {
  return text
    .slice(0, MAX_SLUG_INPUT)
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[ßæœøđðþłıħ]/g, (c) => FOLD[c])
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// FNV-1a, 32 bit, base 36: a short stable tag for text with no Latin letters.
function shortHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const trimBase = (s: string) => s.slice(0, MAX_SLUG_BASE).replace(/-+$/g, "");

/** Slug base for a song: "<title>-<artist>". songKey seeds the fallback. */
export function songSlugBase(title: string, artist: string, songKey: string): string {
  const titlePart = slugPart(title) || `song-${shortHash(songKey)}`;
  const artistPart = slugPart(artist);
  return trimBase(artistPart ? `${titlePart}-${artistPart}` : titlePart);
}

/** Slug base for an artist. artistKey seeds the fallback. */
export function artistSlugBase(name: string, artistKey: string): string {
  return trimBase(slugPart(name)) || `artist-${shortHash(artistKey)}`;
}

/**
 * The first free slug for a base: the base itself, then "-2", "-3" and so on.
 * `taken` reports whether a slug is already in use.
 */
export async function firstFreeSlug(
  base: string,
  taken: (slug: string) => Promise<boolean>
): Promise<string> {
  for (let n = 1; n < 100000; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    if (RESERVED_SLUGS.has(slug)) continue;
    if (!(await taken(slug))) return slug;
  }
  throw new Error(`No free slug for "${base}"`);
}

// --- Publishing decision ---

export type RecordingMatch = {
  title: string;
  artist: string;
  year?: number;
  mbid: string;
  // MusicBrainz release group of the recording's earliest release: the key
  // of its cover in the Cover Art Archive.
  releaseGroupId?: string;
  // MusicBrainz id of the artist the song is published under.
  artistMbid?: string;
};

export type SongDecision = {
  title: string;
  artist: string;
  year?: number;
  mbid?: string;
  releaseGroupId?: string;
  artistMbid?: string;
  status: "live" | "held";
  heldReason?: "no_match" | "filtered";
};

/**
 * What a new candidate is published as. A matched song is live unless its
 * title or artist holds a blocked term. An unmatched song is held and carries
 * the two key halves as its title and artist.
 */
export function decideSong(songKey: string, match: RecordingMatch | null): SongDecision {
  const { artistKey, titleKey } = splitSongKey(songKey);
  const blocked =
    isBlocked(titleKey) ||
    isBlocked(artistKey) ||
    (match !== null && (isBlocked(match.title) || isBlocked(match.artist)));
  if (!match) {
    return {
      title: titleKey,
      artist: artistKey,
      status: "held",
      heldReason: blocked ? "filtered" : "no_match",
    };
  }
  const named = {
    title: match.title,
    artist: match.artist,
    year: match.year,
    mbid: match.mbid,
    releaseGroupId: match.releaseGroupId,
    artistMbid: match.artistMbid,
  };
  return blocked ? { ...named, status: "held", heldReason: "filtered" } : { ...named, status: "live" };
}

/**
 * True when an artist row takes its songs off the public pages: the artist is
 * held for any reason other than "below_bar". A "below_bar" artist only lacks
 * a page of its own.
 */
export const hidesSongs = (artist: { status: "live" | "held"; heldReason?: string | null }) =>
  artist.status === "held" && artist.heldReason !== "below_bar";

// --- ISO weeks ---

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_ID = /^(\d{4})-W(0[1-9]|[1-4]\d|5[0-3])$/;

export const isWeekId = (week: string) => WEEK_ID.test(week);

// Monday 00:00 UTC of ISO week 1: the week that holds January 4th.
function firstMonday(isoYear: number): number {
  const jan4 = Date.UTC(isoYear, 0, 4);
  const daysFromMonday = (new Date(jan4).getUTCDay() + 6) % 7;
  return jan4 - daysFromMonday * DAY_MS;
}

/** ISO 8601 week id ("2026-W47") of a UTC instant. Weeks run Monday to Sunday. */
export function weekIdFor(ms: number): string {
  const d = new Date(ms);
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const daysFromMonday = (new Date(day).getUTCDay() + 6) % 7;
  // The ISO year of a week is the calendar year of its Thursday.
  const isoYear = new Date(day + (3 - daysFromMonday) * DAY_MS).getUTCFullYear();
  const week = Math.floor((day - firstMonday(isoYear)) / (7 * DAY_MS)) + 1;
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** First (Monday) and last (Sunday) UTC dates of an ISO week, "YYYY-MM-DD". */
export function weekRange(week: string): { weekStart: string; weekEnd: string } {
  const m = WEEK_ID.exec(week);
  if (!m) throw new Error(`Not an ISO week id: ${week}`);
  const start = firstMonday(Number(m[1])) + (Number(m[2]) - 1) * 7 * DAY_MS;
  return { weekStart: ymd(start), weekEnd: ymd(start + 6 * DAY_MS) };
}

// --- Chart lists ---

export type ChartRow = { slug: string; value: number };
export type ChartLists = {
  mostPickedSongs: ChartRow[];
  mostPickedArtists: ChartRow[];
  highestRated: ChartRow[];
  mostDivisive: ChartRow[];
  movers: ChartRow[] | null;
};

export type ChartSong = { slug: string; songKey: string; totals: SongTotals };
export type ChartArtist = { slug: string; picks: number };

// `tie` breaks equal values: the larger wins, then the slug.
export type Scored = { slug: string; value: number; tie: number };

/** Chart order: largest value first, then the larger tie, then the slug. */
export const chartOrder = (a: Scored, b: Scored): number =>
  b.value - a.value || b.tie - a.tie || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);

function ranked(rows: Scored[], size: number): ChartRow[] {
  return rows
    .sort(chartOrder)
    .slice(0, size)
    .map(({ slug, value }) => ({ slug, value }));
}

/**
 * The week's lists from the live songs and live artists.
 *
 * `priorPicks` maps songKey to the picks stored in the latest baseline of an
 * earlier week, or is null when there is none; movers is then null. A song
 * missing from that baseline had fewer than BASELINE_MIN_PICKS picks and
 * counts from zero. Only songs that gained picks are movers.
 */
export function computeLists(
  songs: ChartSong[],
  artists: ChartArtist[],
  priorPicks: Map<string, number> | null
): ChartLists {
  const rated = songs.filter((s) => s.totals.ratingCount >= RATED_MIN_RATINGS);
  return {
    mostPickedSongs: ranked(
      songs.map((s) => ({ slug: s.slug, value: s.totals.picks, tie: s.totals.ratingCount })),
      CHART_SIZE
    ),
    mostPickedArtists: ranked(
      artists.map((a) => ({ slug: a.slug, value: a.picks, tie: 0 })),
      CHART_SIZE
    ),
    highestRated: ranked(
      rated.map((s) => ({
        slug: s.slug,
        value: round2(s.totals.ratingSum / s.totals.ratingCount),
        tie: s.totals.ratingCount,
      })),
      CHART_SIZE
    ),
    mostDivisive: ranked(
      rated.map((s) => ({
        slug: s.slug,
        value: round2(ratingSpread(s.totals.ratingHist)),
        tie: s.totals.ratingCount,
      })),
      SHORT_CHART_SIZE
    ),
    movers:
      priorPicks === null
        ? null
        : ranked(
            songs
              .map((s) => ({
                slug: s.slug,
                value: s.totals.picks - (priorPicks.get(s.songKey) ?? 0),
                tie: s.totals.picks,
              }))
              .filter((s) => s.value > 0),
            SHORT_CHART_SIZE
          ),
  };
}
