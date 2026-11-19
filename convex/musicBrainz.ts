/**
 * MusicBrainz recording lookup for the published content pages.
 *
 * The names shown on public pages come from here, never from the strings
 * stored in songStats. Only musicbrainz.org is called, with the User-Agent
 * MusicBrainz requires and at most one request per REQUEST_INTERVAL_MS
 * (lookupRecording waits on a pacer from makePacer before every request,
 * retries included).
 *
 * MusicBrainz lists one song as many recordings (single, album, clean, live,
 * video), and credits featured artists in the artist credit: "The Weeknd
 * feat. Daft Punk". A song key holds the lead artist only, so the recordings
 * of one key carry different credits, scores and first release dates.
 * pickRecording reads them as one song.
 */
import { clean } from "./songStats";
import { splitSongKey, type RecordingMatch } from "./contentLib";

export const MUSICBRAINZ_HOST = "musicbrainz.org";
const RECORDING_ENDPOINT = `https://${MUSICBRAINZ_HOST}/ws/2/recording`;
export const MUSICBRAINZ_USER_AGENT = "AuxWars/1.0 ( https://www.aux-wars.com )";
// MusicBrainz allows one request per second per client.
export const REQUEST_INTERVAL_MS = 1100;
const REQUEST_TIMEOUT_MS = 10_000;
// A song is matched only when one of its recordings scores at least this.
export const MATCH_MIN_SCORE = 90;
// The recording whose title, artist and year are published scores at least this.
export const PUBLISH_MIN_SCORE = 70;
// A request answered 503 or 429, or one that never got an answer, is sent
// again after each of these waits in turn. After the last one the lookup is
// reported as unavailable.
export const RETRY_WAITS_MS = [2000, 4000, 8000];
const RETRY_STATUSES = new Set([429, 503]);
const RESULT_LIMIT = 25;
const MAX_NAME = 300;

/** Search URL for the recording a song key names. */
export function recordingSearchUrl(songKey: string): string {
  const { artistKey, titleKey } = splitSongKey(songKey);
  // A grouped term query, not a quoted phrase: a key half has lost its
  // punctuation ("can t tell me nothing"), and a phrase of those tokens does
  // not find "Can't Tell Me Nothing". pickRecording still requires the exact
  // title and artist. Anything but letters, digits and spaces is stripped so
  // the value can never leave its group.
  const phrase = (s: string) => `(${s.replace(/[^\p{L}\p{N} ]/gu, " ")})`;
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

/**
 * The artist name to publish for a credit, or "" when the credit is not the
 * key's artist. The whole credit is used when it equals the key half under
 * clean(). Otherwise the first credited name is used when it equals the key
 * half, which covers "Travis Scott feat. Playboi Carti" for a "travis scott"
 * key. Either way the returned name cleans to artistKey.
 */
function artistFor(credit: unknown, artistKey: string): string {
  const whole = creditName(credit);
  if (whole && clean(whole) === artistKey) return whole;
  const first = Array.isArray(credit) ? (credit[0] as ArtistCredit | null)?.name : undefined;
  const lead = typeof first === "string" ? first.trim() : "";
  return lead && clean(lead) === artistKey ? lead : "";
}

const RELEASE_DATE = /^\d{4}(-\d{2}(-\d{2})?)?$/;
const UNDATED = "9999-99-99";

/**
 * Year of a first release date, and a string that sorts recordings by it,
 * earliest first. MusicBrainz dates are "2016", "2016-09" or "2016-09-22". A
 * missing month or day sorts after every known one in the same year, and a
 * recording without a usable date sorts last.
 */
function firstRelease(date: unknown): { year: number | undefined; released: string } {
  if (typeof date !== "string" || !RELEASE_DATE.test(date)) return { year: undefined, released: UNDATED };
  const year = Number(date.slice(0, 4));
  if (year < 1000 || year > 2100) return { year: undefined, released: UNDATED };
  return { year, released: date + "-99-99".slice(date.length - 4) };
}

/**
 * Picks the recording to publish from a search response, or null.
 *
 * A recording belongs to the song when its title, run through clean(), equals
 * the title half of the song key and its artist credit names the key's artist
 * (artistFor). The song is matched when at least one of those recordings
 * scores MATCH_MIN_SCORE or more. The recording returned is the earliest
 * first release among those that score PUBLISH_MIN_SCORE or more: the best
 * scored one is often a later live or undated copy, and its date is not the
 * song's. Equal dates go to the lowest mbid, so the pick does not depend on
 * the order of the response.
 */
export function pickRecording(songKey: string, body: unknown): RecordingMatch | null {
  const recordings = (body as { recordings?: unknown } | null)?.recordings;
  if (!Array.isArray(recordings)) return null;
  const { artistKey, titleKey } = splitSongKey(songKey);

  let best: (RecordingMatch & { released: string }) | null = null;
  let matched = false;
  for (const r of recordings as (Record<string, unknown> | null)[]) {
    if (r === null || typeof r !== "object") continue;
    const title = typeof r.title === "string" ? r.title.trim() : "";
    const mbid = typeof r.id === "string" ? r.id : "";
    if (!title || !mbid || title.length > MAX_NAME || clean(title) !== titleKey) continue;
    const artist = artistFor(r["artist-credit"], artistKey);
    if (!artist || artist.length > MAX_NAME) continue;
    const score = Number(r.score) || 0;
    if (score >= MATCH_MIN_SCORE) matched = true;
    if (score < PUBLISH_MIN_SCORE) continue;
    const { year, released } = firstRelease(r["first-release-date"]);
    const earlier =
      best === null || released < best.released || (released === best.released && mbid < best.mbid);
    if (earlier) best = { title, artist, year, mbid, released };
  }
  if (!best || !matched) return null;
  return { title: best.title, artist: best.artist, year: best.year, mbid: best.mbid };
}

export type LookupResult =
  | { kind: "match"; match: RecordingMatch }
  | { kind: "none" }
  // No answer after every retry, or an answer that is not a search result.
  // Nothing is known about the song; it can be looked up again later.
  | { kind: "unavailable" };

// One search request. "retry" is an answer worth asking for again: 503
// (busy), 429 (rate limited), or no answer at all (network error, timeout).
async function searchOnce(songKey: string): Promise<LookupResult | "retry"> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(recordingSearchUrl(songKey), {
      headers: { "User-Agent": MUSICBRAINZ_USER_AGENT, Accept: "application/json" },
      signal: controller.signal,
    });
    // 400: MusicBrainz rejected the query itself, so asking again cannot help.
    if (res.status === 400) return { kind: "none" };
    if (RETRY_STATUSES.has(res.status)) return "retry";
    if (!res.ok) return { kind: "unavailable" };
    const match = pickRecording(songKey, await res.json());
    return match ? { kind: "match", match } : { kind: "none" };
  } catch {
    return "retry";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Looks a song key up, sending the request again after each of
 * RETRY_WAITS_MS while MusicBrainz answers 503 or 429 or does not answer.
 * `pace` is awaited before every request, so share one pacer between all
 * lookups of a run.
 */
export async function lookupRecording(
  songKey: string,
  pace: () => Promise<void> = makePacer()
): Promise<LookupResult> {
  for (let attempt = 0; ; attempt++) {
    await pace();
    const result = await searchOnce(songKey);
    if (result !== "retry") return result;
    if (attempt >= RETRY_WAITS_MS.length) return { kind: "unavailable" };
    await new Promise((resolve) => setTimeout(resolve, RETRY_WAITS_MS[attempt]));
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
