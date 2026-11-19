/**
 * MusicBrainz recording lookup for the published content pages.
 *
 * The names shown on public pages come from here, never from the strings
 * stored in songStats. Only musicbrainz.org is called, with the User-Agent
 * MusicBrainz requires and at most one request per REQUEST_INTERVAL_MS (the
 * caller paces requests with makePacer).
 */
import { clean } from "./songStats";
import { splitSongKey, type RecordingMatch } from "./contentLib";

export const MUSICBRAINZ_HOST = "musicbrainz.org";
const RECORDING_ENDPOINT = `https://${MUSICBRAINZ_HOST}/ws/2/recording`;
export const MUSICBRAINZ_USER_AGENT = "AuxWars/1.0 ( https://www.aux-wars.com )";
// MusicBrainz allows one request per second per client.
export const REQUEST_INTERVAL_MS = 1100;
const REQUEST_TIMEOUT_MS = 10_000;
// A search result below this score is never accepted.
export const MIN_SCORE = 90;
const RESULT_LIMIT = 25;
const MAX_NAME = 300;

/** Search URL for the recording a song key names. */
export function recordingSearchUrl(songKey: string): string {
  const { artistKey, titleKey } = splitSongKey(songKey);
  // Key halves hold only letters, digits and spaces; quotes and backslashes
  // are stripped anyway so the value can never leave its Lucene phrase.
  const phrase = (s: string) => `"${s.replace(/["\\]/g, " ")}"`;
  const url = new URL(RECORDING_ENDPOINT);
  url.searchParams.set("query", `recording:${phrase(titleKey)} AND artist:${phrase(artistKey)}`);
  url.searchParams.set("fmt", "json");
  url.searchParams.set("limit", String(RESULT_LIMIT));
  return url.toString();
}

type ArtistCredit = { name?: unknown; joinphrase?: unknown };

// "Shawn Mendes & Camila Cabello": each credited name followed by its join phrase.
function creditName(credit: unknown): string {
  if (!Array.isArray(credit)) return "";
  return (credit as ArtistCredit[])
    .map((c) => `${typeof c?.name === "string" ? c.name : ""}${typeof c?.joinphrase === "string" ? c.joinphrase : ""}`)
    .join("")
    .trim();
}

function releaseYear(date: unknown): number | undefined {
  if (typeof date !== "string") return undefined;
  const year = Number(date.slice(0, 4));
  return Number.isInteger(year) && year >= 1000 && year <= 2100 ? year : undefined;
}

/**
 * Picks the recording to publish from a search response, or null.
 *
 * A recording is accepted only when its score is at least MIN_SCORE and its
 * title and artist credit, run through clean(), equal the two halves of the
 * song key. Among accepted recordings the earliest first release wins (the
 * same song is listed once per release), then the higher score.
 */
export function pickRecording(songKey: string, body: unknown): RecordingMatch | null {
  const recordings = (body as { recordings?: unknown } | null)?.recordings;
  if (!Array.isArray(recordings)) return null;
  const { artistKey, titleKey } = splitSongKey(songKey);

  let best: (RecordingMatch & { score: number }) | null = null;
  for (const r of recordings as Record<string, unknown>[]) {
    const score = Number(r?.score);
    if (!(score >= MIN_SCORE)) continue;
    const title = typeof r.title === "string" ? r.title.trim() : "";
    const artist = creditName(r["artist-credit"]);
    const mbid = typeof r.id === "string" ? r.id : "";
    if (!title || !artist || !mbid) continue;
    if (title.length > MAX_NAME || artist.length > MAX_NAME) continue;
    if (clean(title) !== titleKey || clean(artist) !== artistKey) continue;
    const year = releaseYear(r["first-release-date"]);
    const earlier =
      best === null ||
      (year ?? Infinity) < (best.year ?? Infinity) ||
      ((year ?? Infinity) === (best.year ?? Infinity) && score > best.score);
    if (earlier) best = { title, artist, year, mbid, score };
  }
  if (!best) return null;
  return { title: best.title, artist: best.artist, year: best.year, mbid: best.mbid };
}

export type LookupResult =
  | { kind: "match"; match: RecordingMatch }
  | { kind: "none" }
  // The request failed or was refused (network error, 503 when the server is
  // busy). Nothing is known about the song; it can be looked up again later.
  | { kind: "unavailable" };

/** One search request. The caller is responsible for pacing. */
export async function lookupRecording(songKey: string): Promise<LookupResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(recordingSearchUrl(songKey), {
      headers: { "User-Agent": MUSICBRAINZ_USER_AGENT, Accept: "application/json" },
      signal: controller.signal,
    });
    // 400: MusicBrainz rejected the query itself, so asking again cannot help.
    if (res.status === 400) return { kind: "none" };
    if (!res.ok) return { kind: "unavailable" };
    const match = pickRecording(songKey, await res.json());
    return match ? { kind: "match", match } : { kind: "none" };
  } catch {
    return { kind: "unavailable" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Returns a function that resolves once at least `intervalMs` has passed since
 * it last resolved. Await it before every request.
 */
export function makePacer(intervalMs = REQUEST_INTERVAL_MS): () => Promise<void> {
  let last = -Infinity;
  return async () => {
    const wait = last + intervalMs - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    last = Date.now();
  };
}
