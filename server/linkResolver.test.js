import { after, before, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSearch } from './linkResolver.js';
import { mapYouTubeTrack, server } from './server.js';

const VIDEO = 'dQw4w9WgXcQ';
const TRACK = '4cOdK2wGLETKBW3PvgPWqT';

const YOUTUBE_OEMBED = `https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D${VIDEO}&format=json`;
const SPOTIFY_OEMBED = `https://open.spotify.com/oembed?url=https%3A%2F%2Fopen.spotify.com%2Ftrack%2F${TRACK}`;
const SPOTIFY_PAGE = `https://open.spotify.com/track/${TRACK}`;

const VIDEO_TRACK = {
  id: `youtube:${VIDEO}`,
  videoId: VIDEO,
  name: 'Never Gonna Give You Up',
  artists: [{ name: 'Rick Astley' }],
  album: { name: '', images: [{ url: `https://i.ytimg.com/vi/${VIDEO}/mqdefault.jpg` }] },
  preview_url: null,
  duration_ms: 0,
  external_url: `https://www.youtube.com/watch?v=${VIDEO}`,
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const html = (body, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html' } });
const notFound = () => new Response('Not Found', { status: 404 });
const redirect = (location, status = 307) => new Response(null, { status, headers: location ? { location } : {} });

const youTubeOEmbed = () =>
  json({
    title: 'Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)',
    author_name: 'Rick Astley',
    type: 'video',
    provider_name: 'YouTube',
  });
const spotifyOEmbed = () => json({ title: 'Never Gonna Give You Up', provider_name: 'Spotify', type: 'rich' });
const spotifyPage = () =>
  html(`<!DOCTYPE html><html><head><meta charSet="utf-8"/>
    <title>Never Gonna Give You Up - Song by Rick Astley | Spotify</title>
    <meta property="og:title" content="Never Gonna Give You Up"/>
    <meta property="og:description" content="Rick Astley · Whenever You Need Somebody · Song · 1987"/>
    <meta name="music:musician" content="https://open.spotify.com/artist/0gxyHStUsqpMadRV0Di1Qt"/>
    <meta name="music:musician_description" content="Rick Astley"/>
    </head><body></body></html>`);

/**
 * A fetch stand-in. `routes` maps "host/path" to a function returning a
 * Response (or throwing); anything else answers 404. Records every call.
 */
function fakeFetch(routes = {}) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    const { host, pathname } = new URL(url);
    const route = routes[`${host}${pathname}`];
    return route ? route(options) : notFound();
  };
  return { fetchImpl, calls, urls: () => calls.map((call) => call.url) };
}

/** A text search stand-in that records its terms. */
function fakeSearch(result = { tracks: [{ id: 'youtube:found', videoId: 'found' }], source: 'youtube' }) {
  const terms = [];
  const searchText = async (term) => {
    terms.push(term);
    return typeof result === 'function' ? result(term) : result;
  };
  return { searchText, terms };
}

const quiet = { error() {} };

function resolve(term, { fetch = fakeFetch(), search = fakeSearch(), timeoutMs } = {}) {
  return resolveSearch(term, {
    searchText: search.searchText,
    mapYouTubeTrack,
    fetchImpl: fetch.fetchImpl,
    logger: quiet,
    timeoutMs,
  });
}

/** A lookup that never answers; it rejects when the request is aborted. */
const hang = (options) =>
  new Promise((_, reject) => {
    options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
  });

// --- Text queries -----------------------------------------------------------

test('a text query goes straight to the text search', async () => {
  const fetch = fakeFetch();
  const found = { tracks: [{ id: 'youtube:abc' }], source: 'youtube' };
  const search = fakeSearch(found);

  assert.deepEqual(await resolve('never gonna give you up', { fetch, search }), found);
  assert.deepEqual(await resolve(`rick astley https://youtu.be/${VIDEO}`, { fetch, search }), found);
  assert.deepEqual(search.terms, ['never gonna give you up', `rick astley https://youtu.be/${VIDEO}`]);
  assert.deepEqual(fetch.calls, []);
});

// --- YouTube ----------------------------------------------------------------

test('a YouTube video link answers with exactly that video', async () => {
  const fetch = fakeFetch({ 'www.youtube.com/oembed': youTubeOEmbed });
  const search = fakeSearch();

  const result = await resolve(`https://www.youtube.com/watch?v=${VIDEO}`, { fetch, search });

  assert.deepEqual(result, { tracks: [VIDEO_TRACK], source: 'youtube', resolvedFrom: 'youtube' });
  assert.deepEqual(fetch.urls(), [YOUTUBE_OEMBED]);
  assert.equal(fetch.calls[0].options.redirect, 'manual');
  assert.deepEqual(search.terms, []);
});

test('every YouTube link form looks up the same video and forwards nothing else from the link', async () => {
  const links = [
    `https://youtu.be/${VIDEO}?si=SHARE_TOKEN`,
    `https://www.youtube.com/shorts/${VIDEO}?feature=share`,
    `https://music.youtube.com/watch?v=${VIDEO}&si=SHARE_TOKEN`,
    `https://m.youtube.com/watch?v=${VIDEO}&t=42s`,
    `https://www.youtube.com/watch?v=${VIDEO}&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf`,
    `youtu.be/${VIDEO}`,
  ];
  for (const link of links) {
    const fetch = fakeFetch({ 'www.youtube.com/oembed': youTubeOEmbed });
    const result = await resolve(link, { fetch });
    assert.deepEqual(result.tracks, [VIDEO_TRACK], link);
    assert.deepEqual(fetch.urls(), [YOUTUBE_OEMBED], link);
  }
});

test('a video titled without an artist is credited to its channel', async () => {
  const fetch = fakeFetch({
    'www.youtube.com/oembed': () => json({ title: 'Some Song (Lyrics)', author_name: 'Some Artist - Topic' }),
  });
  const { tracks } = await resolve(`https://youtu.be/${VIDEO}`, { fetch });
  assert.equal(tracks[0].name, 'Some Song');
  assert.deepEqual(tracks[0].artists, [{ name: 'Some Artist' }]);
});

test('when oEmbed has no answer, the id is searched as text and only that video is kept', async () => {
  const failures = {
    'not found': notFound,
    'not embeddable': () => new Response('Unauthorized', { status: 401 }),
    'network error': () => {
      throw new TypeError('fetch failed');
    },
    'not JSON': () => html('<html>oops</html>'),
    'no title': () => json({ author_name: 'Rick Astley' }),
    'blank title': () => json({ title: '   ' }),
    'a redirect': () => redirect('https://example.com/'),
  };
  for (const [name, route] of Object.entries(failures)) {
    const fetch = fakeFetch({ 'www.youtube.com/oembed': route });
    const other = { id: 'youtube:other000000', videoId: 'other000000' };
    const search = fakeSearch({ tracks: [other, VIDEO_TRACK], source: 'youtube' });

    const result = await resolve(`https://youtu.be/${VIDEO}`, { fetch, search });

    assert.deepEqual(search.terms, [VIDEO], name);
    // Other search hits are dropped: a link never lists unrelated videos.
    assert.deepEqual(result, { tracks: [VIDEO_TRACK], source: 'youtube', resolvedFrom: 'youtube' }, name);
    assert.deepEqual(fetch.urls(), [YOUTUBE_OEMBED], name);
  }
});

test('a YouTube link the search cannot find either answers with no tracks', async () => {
  const fetch = fakeFetch({ 'www.youtube.com/oembed': notFound });
  const search = fakeSearch({ tracks: [{ id: 'youtube:other000000', videoId: 'other000000' }], source: 'youtube' });

  const result = await resolve(`https://youtu.be/${VIDEO}`, { fetch, search });

  assert.deepEqual(search.terms, [VIDEO]);
  assert.deepEqual(result.tracks, []);
  assert.equal(result.resolvedFrom, 'youtube');
});

test('a playlist-only YouTube link answers with no tracks and makes no request', async () => {
  const fetch = fakeFetch({ 'www.youtube.com/oembed': youTubeOEmbed });
  const search = fakeSearch();

  const result = await resolve('https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf', { fetch, search });

  assert.deepEqual(result, { tracks: [], source: null, resolvedFrom: 'youtube' });
  assert.deepEqual(fetch.calls, []);
  assert.deepEqual(search.terms, []);
});

// --- Spotify ----------------------------------------------------------------

test('a Spotify track link is searched by its title and artist', async () => {
  const fetch = fakeFetch({
    'open.spotify.com/oembed': spotifyOEmbed,
    [`open.spotify.com/track/${TRACK}`]: spotifyPage,
  });
  const found = { tracks: [VIDEO_TRACK], source: 'youtube' };
  const search = fakeSearch(found);

  const result = await resolve(`https://open.spotify.com/intl-es/track/${TRACK}?si=SHARE_TOKEN`, { fetch, search });

  assert.deepEqual(result, { ...found, resolvedFrom: 'spotify' });
  assert.deepEqual(search.terms, ['Never Gonna Give You Up Rick Astley']);
  assert.deepEqual(fetch.urls().sort(), [SPOTIFY_OEMBED, SPOTIFY_PAGE].sort());
  for (const call of fetch.calls) assert.equal(call.options.redirect, 'manual');
});

test('a Spotify track link reports the source the text search used', async () => {
  const fetch = fakeFetch({ 'open.spotify.com/oembed': spotifyOEmbed });
  const found = { tracks: [{ id: 'itunes:1', preview_url: 'https://example.com/a.m4a' }], source: 'itunes_deezer_fallback' };
  const result = await resolve(`https://open.spotify.com/track/${TRACK}`, { fetch, search: fakeSearch(found) });
  assert.deepEqual(result, { ...found, resolvedFrom: 'spotify' });
});

test('without a readable artist, a Spotify track link is searched by title alone', async () => {
  const pages = {
    'page not found': notFound,
    'page fails': () => {
      throw new TypeError('fetch failed');
    },
    'page has no metadata': () => html('<html><head><title>Spotify</title></head></html>'),
    'page redirects': () => redirect('https://example.com/login'),
  };
  for (const [name, page] of Object.entries(pages)) {
    const fetch = fakeFetch({ 'open.spotify.com/oembed': spotifyOEmbed, [`open.spotify.com/track/${TRACK}`]: page });
    const search = fakeSearch();
    await resolve(`https://open.spotify.com/track/${TRACK}`, { fetch, search });
    assert.deepEqual(search.terms, ['Never Gonna Give You Up'], name);
  }
});

test('the track page alone is enough when Spotify oEmbed has no answer', async () => {
  const fetch = fakeFetch({ [`open.spotify.com/track/${TRACK}`]: spotifyPage });
  const search = fakeSearch();
  await resolve(`https://open.spotify.com/track/${TRACK}`, { fetch, search });
  assert.deepEqual(search.terms, ['Never Gonna Give You Up Rick Astley']);
});

test('track page metadata is decoded, and the artist falls back to the description', async () => {
  const fetch = fakeFetch({
    [`open.spotify.com/track/${TRACK}`]: () =>
      html(`<head>
        <meta content='Don&#x27;t Stop Believin&#39;' property='og:title'>
        <meta property="og:description" content="Simon &amp; Garfunkel · Greatest   Hits · Song · 1972">
      </head>`),
  });
  const search = fakeSearch();
  await resolve(`https://open.spotify.com/track/${TRACK}`, { fetch, search });
  assert.deepEqual(search.terms, ["Don't Stop Believin' Simon & Garfunkel"]);
});

test('a Spotify track link with nothing readable answers with no tracks', async () => {
  const fetch = fakeFetch({
    'open.spotify.com/oembed': () => json({ title: '' }),
    [`open.spotify.com/track/${TRACK}`]: notFound,
  });
  const search = fakeSearch();

  const result = await resolve(`https://open.spotify.com/track/${TRACK}`, { fetch, search });

  assert.deepEqual(result, { tracks: [], source: null, resolvedFrom: 'spotify' });
  assert.deepEqual(search.terms, []);
});

test('only the head of the track page is read', async () => {
  let chunks = 0;
  const endless = () =>
    new Response(
      new ReadableStream({
        pull(controller) {
          chunks += 1;
          const text = chunks === 1 ? '<meta name="music:musician_description" content="Rick Astley"/>' : '';
          controller.enqueue(new TextEncoder().encode(text.padEnd(16 * 1024, ' ')));
        },
      }),
      { status: 200 }
    );
  const fetch = fakeFetch({ 'open.spotify.com/oembed': spotifyOEmbed, [`open.spotify.com/track/${TRACK}`]: endless });
  const search = fakeSearch();

  await resolve(`https://open.spotify.com/track/${TRACK}`, { fetch, search });

  assert.deepEqual(search.terms, ['Never Gonna Give You Up Rick Astley']);
  assert.ok(chunks <= 6, `read ${chunks} chunks of 16 KB`);
});

test('a spotify.link short link is resolved when it redirects to a Spotify track', async () => {
  const fetch = fakeFetch({
    'spotify.link/AbCd1234XyZ': () => redirect(`https://open.spotify.com/track/${TRACK}?si=SHARE_TOKEN&_branch_match_id=1`),
    'open.spotify.com/oembed': spotifyOEmbed,
    [`open.spotify.com/track/${TRACK}`]: spotifyPage,
  });
  const search = fakeSearch();

  const result = await resolve('https://spotify.link/AbCd1234XyZ', { fetch, search });

  assert.equal(result.resolvedFrom, 'spotify');
  assert.deepEqual(search.terms, ['Never Gonna Give You Up Rick Astley']);
  assert.equal(fetch.calls[0].url, 'https://spotify.link/AbCd1234XyZ');
  assert.equal(fetch.calls[0].options.redirect, 'manual');
  assert.deepEqual(fetch.urls().slice(1).sort(), [SPOTIFY_OEMBED, SPOTIFY_PAGE].sort());
});

test('a spotify.link short link that does not redirect to a Spotify track answers with no tracks', async () => {
  const targets = {
    'another host': () => redirect(`https://example.com/track/${TRACK}`),
    'a look-alike host': () => redirect(`https://open.spotify.com.example.com/track/${TRACK}`),
    'plain http': () => redirect(`http://open.spotify.com/track/${TRACK}`),
    'the Spotify home page': () => redirect('https://open.spotify.com/'),
    'a Spotify album': () => redirect('https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3'),
    'a second short link': () => redirect('https://spotify.link/AnotherCode'),
    'a relative path': () => redirect(`/track/${TRACK}`),
    'no Location header': () => redirect(null),
    'a page instead of a redirect': () => html(`<a href="https://open.spotify.com/track/${TRACK}">Open</a>`),
    'not found': notFound,
    'a network error': () => {
      throw new TypeError('fetch failed');
    },
  };
  for (const [name, route] of Object.entries(targets)) {
    const fetch = fakeFetch({
      'spotify.link/AbCd1234XyZ': route,
      'open.spotify.com/oembed': spotifyOEmbed,
      [`open.spotify.com/track/${TRACK}`]: spotifyPage,
    });
    const search = fakeSearch();

    const result = await resolve('https://spotify.link/AbCd1234XyZ', { fetch, search });

    assert.deepEqual(result, { tracks: [], source: null, resolvedFrom: 'spotify' }, name);
    assert.deepEqual(fetch.urls(), ['https://spotify.link/AbCd1234XyZ'], name);
    assert.deepEqual(search.terms, [], name);
  }
});

// --- SoundCloud and other links --------------------------------------------

test('SoundCloud and other links answer with no tracks, no request and no search', async () => {
  const links = {
    'https://soundcloud.com/some-artist/some-track': 'soundcloud',
    'https://m.soundcloud.com/some-artist/some-track': 'soundcloud',
    'https://on.soundcloud.com/AbCd1234': 'soundcloud',
    'https://music.apple.com/us/album/some-album/1234567890?i=1234567891': 'other',
    'https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3': 'other',
    'https://www.youtube.com/@SomeChannel': 'other',
    'http://169.254.169.254/latest/meta-data/': 'other',
    'http://localhost:3002/': 'other',
  };
  for (const [link, kind] of Object.entries(links)) {
    const fetch = fakeFetch();
    const search = fakeSearch();
    assert.deepEqual(await resolve(link, { fetch, search }), { tracks: [], source: null, resolvedFrom: kind }, link);
    assert.deepEqual(fetch.calls, [], link);
    assert.deepEqual(search.terms, [], link);
  }
});

// --- Time budget and outbound safety ---------------------------------------

test('lookups that run out of time count as nothing readable', async () => {
  const stuckSpotify = fakeFetch({ 'open.spotify.com/oembed': hang, [`open.spotify.com/track/${TRACK}`]: hang });
  const spotifySearch = fakeSearch();
  const started = Date.now();
  assert.deepEqual(
    await resolve(`https://open.spotify.com/track/${TRACK}`, { fetch: stuckSpotify, search: spotifySearch, timeoutMs: 40 }),
    { tracks: [], source: null, resolvedFrom: 'spotify' }
  );
  assert.deepEqual(spotifySearch.terms, []);

  const stuckShortLink = fakeFetch({ 'spotify.link/AbCd1234XyZ': hang });
  assert.deepEqual(
    await resolve('https://spotify.link/AbCd1234XyZ', { fetch: stuckShortLink, timeoutMs: 40 }),
    { tracks: [], source: null, resolvedFrom: 'spotify' }
  );

  // A YouTube link still answers: its id is searched as text.
  const stuckYouTube = fakeFetch({ 'www.youtube.com/oembed': hang });
  const youTubeSearch = fakeSearch();
  await resolve(`https://youtu.be/${VIDEO}`, { fetch: stuckYouTube, search: youTubeSearch, timeoutMs: 40 });
  assert.deepEqual(youTubeSearch.terms, [VIDEO]);

  assert.ok(Date.now() - started < 2000, 'each search gave up at its deadline');
});

test('one deadline covers the short link and the lookups after it', async () => {
  const slowRedirect = () =>
    new Promise((done) => setTimeout(() => done(redirect(`https://open.spotify.com/track/${TRACK}`)), 60));
  const fetch = fakeFetch({
    'spotify.link/AbCd1234XyZ': slowRedirect,
    'open.spotify.com/oembed': hang,
    [`open.spotify.com/track/${TRACK}`]: hang,
  });
  const started = Date.now();

  const result = await resolve('https://spotify.link/AbCd1234XyZ', { fetch, timeoutMs: 120 });

  assert.deepEqual(result.tracks, []);
  assert.ok(Date.now() - started < 1000);
});

test('requests go only to the fixed lookup endpoints, never to the pasted URL', async () => {
  const allowed = [
    /^https:\/\/www\.youtube\.com\/oembed\?url=https%3A%2F%2Fwww\.youtube\.com%2Fwatch%3Fv%3D[A-Za-z0-9_-]{11}&format=json$/,
    /^https:\/\/open\.spotify\.com\/oembed\?url=https%3A%2F%2Fopen\.spotify\.com%2Ftrack%2F[A-Za-z0-9]{22}$/,
    /^https:\/\/open\.spotify\.com\/track\/[A-Za-z0-9]{22}$/,
    /^https:\/\/spotify\.link\/[A-Za-z0-9]{1,40}$/,
  ];
  const pasted = [
    `https://www.youtube.com/watch?v=${VIDEO}&next=https://example.com/steal#frag`,
    `http://youtu.be/${VIDEO}?x=%0d%0aHost:%20example.com`,
    `https://user:pass@www.youtube.com/watch?v=${VIDEO}`,
    `https://www.youtube.com:8443/watch?v=${VIDEO}`,
    `https://www.youtube.com/watch?v=${VIDEO}/../../oembed`,
    `https://www.youtube.com/watch?v=../../etc/passwd`,
    `https://youtu.be/..%2F..%2Fadmin`,
    `https://open.spotify.com/track/${TRACK}?url=https://example.com/`,
    `https://open.spotify.com/track/${TRACK}/../../oembed?url=http://example.com`,
    `https://open.spotify.com/track/..%2F..%2Foembed`,
    `https://open.spotify.com@example.com/track/${TRACK}`,
    `https://open.spotify.com.example.com/track/${TRACK}`,
    'https://spotify.link/AbCd1234XyZ?next=https://example.com/',
    'https://spotify.link/..%2Fadmin',
    'https://example.com/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]:3002/',
    'https://soundcloud.com/some-artist/some-track',
  ];
  for (const link of pasted) {
    const fetch = fakeFetch({
      'www.youtube.com/oembed': youTubeOEmbed,
      'open.spotify.com/oembed': spotifyOEmbed,
      [`open.spotify.com/track/${TRACK}`]: spotifyPage,
      'spotify.link/AbCd1234XyZ': () => redirect(`https://open.spotify.com/track/${TRACK}`),
    });
    await resolve(link, { fetch });
    for (const url of fetch.urls()) {
      assert.ok(allowed.some((pattern) => pattern.test(url)), `${link} fetched ${url}`);
      assert.doesNotMatch(url, /example\.com|169\.254|\[::1\]|user:pass|8443/, link);
    }
  }
});

// --- The HTTP endpoint ------------------------------------------------------

let baseUrl;
const realFetch = globalThis.fetch;

before(async () => {
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  mock.restoreAll();
  server.closeAllConnections();
  await new Promise((done) => server.close(done));
});

/** Routes the server's outbound lookups to `fake`; the test's own request to the server goes through. */
function stubOutbound(fake) {
  mock.method(globalThis, 'fetch', (url, options) =>
    String(url).startsWith(baseUrl) ? realFetch(url, options) : fake.fetchImpl(url, options)
  );
}

function post(path, query) {
  return realFetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query }),
  });
}

test('POST /api/music/search answers a YouTube link with that video and resolvedFrom', async () => {
  const fake = fakeFetch({ 'www.youtube.com/oembed': youTubeOEmbed });
  stubOutbound(fake);

  const response = await post('/api/music/search', `  https://youtu.be/${VIDEO}?si=SHARE_TOKEN  `);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { tracks: [VIDEO_TRACK], resolvedFrom: 'youtube' });
  assert.deepEqual(fake.urls(), [YOUTUBE_OEMBED]);
});

test('both search routes answer a SoundCloud link with 200 and no tracks', async () => {
  for (const path of ['/api/music/search', '/api/youtube/search']) {
    const fake = fakeFetch();
    stubOutbound(fake);

    const response = await post(path, 'https://soundcloud.com/some-artist/some-track');

    assert.equal(response.status, 200, path);
    assert.deepEqual(await response.json(), { tracks: [], resolvedFrom: 'soundcloud' }, path);
    assert.deepEqual(fake.calls, [], path);
  }
});

test('POST /api/music/search answers an unreadable Spotify link with 200 and no tracks', async () => {
  const fake = fakeFetch();
  stubOutbound(fake);
  mock.method(console, 'error', () => {});

  const response = await post('/api/music/search', `https://open.spotify.com/track/${TRACK}`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { tracks: [], resolvedFrom: 'spotify' });
});
