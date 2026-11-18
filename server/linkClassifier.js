/**
 * Link classifier for the music search box.
 *
 * Decides whether a search query is a single pasted link and, if so, which
 * service it points at. Pure: no network, no state.
 *
 * Result shapes:
 *   { kind: null }                                    not a link, search it as text
 *   { kind: 'youtube', videoId, playlistOnly: false } one video
 *   { kind: 'youtube', videoId: null, playlistOnly: true }
 *   { kind: 'spotify', trackId }                      open.spotify.com track
 *   { kind: 'spotify', shortCode }                    spotify.link short link
 *   { kind: 'soundcloud', user, track }               soundcloud.com track
 *   { kind: 'soundcloud', shortCode }                 on.soundcloud.com short link
 *   { kind: 'other' }                                 any other web link
 *
 * Every id in a result has been matched against its pattern below, so callers
 * can place it in an outbound URL without further checks.
 *
 * A query is a link only when the whole trimmed query is one URL. A URL among
 * other words stays a text search. A query without an http(s) scheme is a link
 * only when it is a recognized form on a known host ("youtu.be/<id>"), so
 * dotted text such as "mr.brightside" or "youtube.com" stays a text search.
 */

export const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
export const SPOTIFY_ID_PATTERN = /^[A-Za-z0-9]{22}$/;
export const SHORT_CODE_PATTERN = /^[A-Za-z0-9]{1,40}$/;
export const SLUG_PATTERN = /^[A-Za-z0-9_-]{1,255}$/;

const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com']);
const YOUTUBE_SHORT_HOST = 'youtu.be';
const SPOTIFY_HOST = 'open.spotify.com';
const SPOTIFY_SHORT_HOST = 'spotify.link';
const SOUNDCLOUD_HOSTS = new Set(['soundcloud.com', 'www.soundcloud.com', 'm.soundcloud.com']);
const SOUNDCLOUD_SHORT_HOST = 'on.soundcloud.com';

const NOT_A_LINK = Object.freeze({ kind: null });
const OTHER_LINK = Object.freeze({ kind: 'other' });

/**
 * @param {string} query - Raw search query
 * @returns {{ kind: 'youtube' | 'spotify' | 'soundcloud' | 'other' | null }}
 */
export function classifyLink(query) {
  if (typeof query !== 'string') return NOT_A_LINK;
  const token = query.trim();
  if (!token || /\s/.test(token)) return NOT_A_LINK;

  const hasScheme = /^https?:\/\//i.test(token);
  const url = parseUrl(hasScheme ? token : `https://${token}`);
  if (!url) return NOT_A_LINK;

  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  const segments = url.pathname.split('/').filter(Boolean);

  const known =
    classifyYouTube(host, segments, url.searchParams) ||
    classifySpotify(host, segments) ||
    classifySoundCloud(host, segments);
  if (known) return known;

  return hasScheme ? OTHER_LINK : NOT_A_LINK;
}

function parseUrl(text) {
  try {
    const url = new URL(text);
    return url.hostname ? url : null;
  } catch {
    return null;
  }
}

function classifyYouTube(host, segments, params) {
  const isShortHost = host === YOUTUBE_SHORT_HOST;
  if (!isShortHost && !YOUTUBE_HOSTS.has(host)) return null;

  let videoId = null;
  if (isShortHost) videoId = segments[0] ?? null;
  else if (segments[0] === 'watch') videoId = params.get('v');
  else if (segments[0] === 'shorts') videoId = segments[1] ?? null;

  if (videoId) {
    return YOUTUBE_ID_PATTERN.test(videoId)
      ? { kind: 'youtube', videoId, playlistOnly: false }
      : null;
  }

  const isPlaylistPath = segments[0] === 'playlist' || segments[0] === 'watch';
  if (!isShortHost && isPlaylistPath && params.get('list')) {
    return { kind: 'youtube', videoId: null, playlistOnly: true };
  }
  return null;
}

function classifySpotify(host, segments) {
  if (host === SPOTIFY_SHORT_HOST) {
    return segments.length === 1 && SHORT_CODE_PATTERN.test(segments[0])
      ? { kind: 'spotify', shortCode: segments[0] }
      : null;
  }
  if (host !== SPOTIFY_HOST) return null;

  // Shared links may carry a locale segment first: /intl-es/track/<id>.
  const path = /^intl-[a-z-]{2,10}$/i.test(segments[0] ?? '') ? segments.slice(1) : segments;
  return path.length === 2 && path[0] === 'track' && SPOTIFY_ID_PATTERN.test(path[1])
    ? { kind: 'spotify', trackId: path[1] }
    : null;
}

function classifySoundCloud(host, segments) {
  if (host === SOUNDCLOUD_SHORT_HOST) {
    return segments.length === 1 && SHORT_CODE_PATTERN.test(segments[0])
      ? { kind: 'soundcloud', shortCode: segments[0] }
      : null;
  }
  if (!SOUNDCLOUD_HOSTS.has(host)) return null;

  return segments.length === 2 && segments.every((s) => SLUG_PATTERN.test(s))
    ? { kind: 'soundcloud', user: segments[0], track: segments[1] }
    : null;
}
