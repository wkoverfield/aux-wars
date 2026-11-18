/**
 * Link resolution for the music search box.
 *
 * `resolveSearch` is the search behind POST /api/music/search. A plain query
 * goes straight to the text search. A query that is one pasted link (see
 * linkClassifier.js) is resolved first:
 *
 *   YouTube video    that exact video as the only track, titled from YouTube
 *                    oEmbed; if oEmbed has no answer, the video id is
 *                    searched as text and only that video is kept
 *   YouTube playlist no tracks
 *   Spotify track    title from Spotify oEmbed, artist from the public track
 *                    page, then a text search of "title artist"
 *   SoundCloud       no tracks (recognized, not resolved)
 *   any other link   no tracks
 *
 * OUTBOUND REQUESTS: the pasted URL itself is never fetched. Requests go only
 * to the fixed endpoints built below, from ids the classifier has already
 * matched against their patterns (each builder checks again). No request
 * follows a redirect; the one redirect that is read (spotify.link) is accepted
 * only when it points at an open.spotify.com track. All lookups for one search
 * share a single deadline, and a lookup that fails or runs out of time counts
 * as "nothing readable".
 */
import {
  classifyLink,
  SHORT_CODE_PATTERN,
  SPOTIFY_ID_PATTERN,
  YOUTUBE_ID_PATTERN,
} from './linkClassifier.js';

// One deadline for every metadata lookup a search makes, so resolving a link
// plus the text search that may follow still fits the client's 8s timeout.
export const LINK_LOOKUP_TIMEOUT_MS = 2500;
// The track page is ~280 KB; its metadata sits in the first few KB.
const MAX_BODY_BYTES = 64 * 1024;
const MAX_TEXT_LENGTH = 120;

const NO_TRACKS = Object.freeze({ tracks: [], source: null });

/**
 * @param {string} term - Trimmed search query
 * @param {Object} deps
 * @param {(term: string) => Promise<{ tracks: Array, source: string | null }>} deps.searchText
 *   The normal text search.
 * @param {(item: { id: string, title: string, channelTitle?: string }) => Object} deps.mapYouTubeTrack
 *   Builds the app track shape for a YouTube video.
 * @param {typeof fetch} [deps.fetchImpl]
 * @param {number} [deps.timeoutMs]
 * @param {{ error: Function }} [deps.logger]
 * @returns {Promise<{ tracks: Array, source: string | null, resolvedFrom?: string }>}
 *   `resolvedFrom` is the link kind, present only when the query was a link.
 */
export async function resolveSearch(term, deps) {
  const link = classifyLink(term);
  if (!link.kind) return deps.searchText(term);

  const ctx = {
    searchText: deps.searchText,
    mapYouTubeTrack: deps.mapYouTubeTrack,
    fetchImpl: deps.fetchImpl ?? globalThis.fetch,
    logger: deps.logger ?? console,
    signal: AbortSignal.timeout(deps.timeoutMs ?? LINK_LOOKUP_TIMEOUT_MS),
  };

  const { tracks, source } = await resolveLink(link, ctx);
  return { tracks, source, resolvedFrom: link.kind };
}

function resolveLink(link, ctx) {
  switch (link.kind) {
    case 'youtube':
      return resolveYouTube(link, ctx);
    case 'spotify':
      return resolveSpotify(link, ctx);
    case 'soundcloud':
      // Recognized so the search answers "no tracks" instead of searching the
      // URL as text. SoundCloud tracks are not resolved or played.
      return NO_TRACKS;
    default:
      return NO_TRACKS;
  }
}

async function resolveYouTube(link, ctx) {
  if (!link.videoId) return NO_TRACKS; // playlist-only link

  const oembed = await lookup(ctx, 'YouTube oEmbed', async () =>
    JSON.parse(await fetchText(youTubeOEmbedUrl(link.videoId), ctx))
  );
  const title = plainText(oembed?.title);
  if (title) {
    const track = ctx.mapYouTubeTrack({
      id: link.videoId,
      title,
      channelTitle: plainText(oembed.author_name),
    });
    return { tracks: [track], source: 'youtube' };
  }

  // oEmbed has no answer (video not embeddable, removed, or the lookup failed):
  // search the id as text and keep only that video. A pasted link answers
  // with the linked video or with nothing, never with unrelated results.
  const found = await ctx.searchText(link.videoId);
  const exact = found.tracks.filter((track) => track.videoId === link.videoId);
  return exact.length > 0 ? { tracks: exact, source: found.source } : NO_TRACKS;
}

async function resolveSpotify(link, ctx) {
  const trackId = link.trackId ?? (await lookup(ctx, 'spotify.link', () => followSpotifyShortLink(link.shortCode, ctx)));
  if (!trackId) return NO_TRACKS;

  const [oembed, page] = await Promise.all([
    lookup(ctx, 'Spotify oEmbed', async () => JSON.parse(await fetchText(spotifyOEmbedUrl(trackId), ctx))),
    lookup(ctx, 'Spotify track page', async () => readTrackPage(await fetchText(spotifyTrackUrl(trackId), ctx))),
  ]);

  const title = plainText(oembed?.title) || page?.title;
  if (!title) return NO_TRACKS;

  const artist = page?.artist;
  return ctx.searchText(artist ? `${title} ${artist}` : title);
}

/**
 * Reads where a spotify.link short link points, without following it.
 * @returns {Promise<string | null>} A Spotify track id, or null when the link
 *   does not redirect straight to an open.spotify.com track.
 */
async function followSpotifyShortLink(shortCode, ctx) {
  const response = await ctx.fetchImpl(spotifyShortLinkUrl(shortCode), {
    redirect: 'manual',
    signal: ctx.signal,
  });
  await response.body?.cancel();
  if (response.status < 300 || response.status >= 400) return null;

  const target = absoluteUrl(response.headers.get('location'));
  if (!target || target.protocol !== 'https:' || target.hostname !== 'open.spotify.com') return null;

  const link = classifyLink(target.href);
  return link.kind === 'spotify' && link.trackId ? link.trackId : null;
}

function absoluteUrl(text) {
  try {
    return text ? new URL(text) : null;
  } catch {
    return null;
  }
}

// --- Outbound URLs: fixed hosts, pattern-checked ids ------------------------

function checkedId(pattern, id) {
  if (typeof id !== 'string' || !pattern.test(id)) throw new Error('Link id failed its pattern check');
  return id;
}

function youTubeOEmbedUrl(videoId) {
  const params = new URLSearchParams({
    url: `https://www.youtube.com/watch?v=${checkedId(YOUTUBE_ID_PATTERN, videoId)}`,
    format: 'json',
  });
  return `https://www.youtube.com/oembed?${params.toString()}`;
}

function spotifyTrackUrl(trackId) {
  return `https://open.spotify.com/track/${checkedId(SPOTIFY_ID_PATTERN, trackId)}`;
}

function spotifyOEmbedUrl(trackId) {
  const params = new URLSearchParams({ url: spotifyTrackUrl(trackId) });
  return `https://open.spotify.com/oembed?${params.toString()}`;
}

function spotifyShortLinkUrl(shortCode) {
  return `https://spotify.link/${checkedId(SHORT_CODE_PATTERN, shortCode)}`;
}

// --- Fetching ---------------------------------------------------------------

/** Runs one lookup; any failure (HTTP, parse, timeout) resolves to null. */
async function lookup(ctx, label, run) {
  try {
    return await run();
  } catch (error) {
    ctx.logger.error(`${label} lookup failed:`, error?.message || error);
    return null;
  }
}

/** GETs a 200 body as text, reading at most MAX_BODY_BYTES. Redirects are not followed. */
async function fetchText(url, ctx) {
  const response = await ctx.fetchImpl(url, { redirect: 'manual', signal: ctx.signal });
  if (response.status !== 200) {
    await response.body?.cancel();
    throw new Error(`responded ${response.status}`);
  }
  const reader = response.body?.getReader();
  if (!reader) return '';

  const decoder = new TextDecoder();
  let text = '';
  let received = 0;
  try {
    while (received < MAX_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return text;
}

// --- Reading metadata -------------------------------------------------------

/** Title and artist from the track page's <meta> tags; either may be ''. */
function readTrackPage(html) {
  const meta = new Map();
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    const key = attribute(tag, 'property') ?? attribute(tag, 'name');
    const content = attribute(tag, 'content');
    if (key && content !== null && !meta.has(key)) meta.set(key, content);
  }
  // og:description reads "Artist · Album · Song · Year".
  const artist =
    htmlText(meta.get('music:musician_description')) ||
    htmlText((meta.get('og:description') ?? '').split(' · ')[0]);
  return { title: htmlText(meta.get('og:title')), artist };
}

function attribute(tag, name) {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return match ? (match[1] ?? match[2]) : null;
}

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]+);/gi, (entity, body) => {
    if (body[0] !== '#') return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
    const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}

/** A metadata value as one short line of text; '' when it is not usable. */
function plainText(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LENGTH);
}

function htmlText(value) {
  return typeof value === 'string' ? plainText(decodeEntities(value)) : '';
}
