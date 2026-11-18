import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyLink } from './linkClassifier.js';

const VIDEO = 'dQw4w9WgXcQ';
const TRACK = '4cOdK2wGLETKBW3PvgPWqT';

const youtube = { kind: 'youtube', videoId: VIDEO, playlistOnly: false };
const spotify = { kind: 'spotify', trackId: TRACK };

function each(cases, expected) {
  for (const input of cases) {
    assert.deepEqual(classifyLink(input), expected, input);
  }
}

test('YouTube video links carry the video id', () => {
  each(
    [
      `https://www.youtube.com/watch?v=${VIDEO}`,
      `https://youtube.com/watch?v=${VIDEO}`,
      `http://www.youtube.com/watch?v=${VIDEO}`,
      `https://m.youtube.com/watch?v=${VIDEO}`,
      `https://www.youtube.com/watch?v=${VIDEO}&t=42s`,
      `https://www.youtube.com/watch?feature=shared&v=${VIDEO}`,
      `https://youtu.be/${VIDEO}`,
      `https://youtu.be/${VIDEO}?si=AbCdEfGhIjKlMnOp`,
      `https://youtu.be/${VIDEO}?t=30`,
      `https://www.youtube.com/shorts/${VIDEO}`,
      `https://youtube.com/shorts/${VIDEO}?feature=share`,
      `https://music.youtube.com/watch?v=${VIDEO}`,
      `https://music.youtube.com/watch?v=${VIDEO}&si=AbCdEfGhIjKlMnOp`,
      `HTTPS://WWW.YOUTUBE.COM/watch?v=${VIDEO}`,
      `  https://youtu.be/${VIDEO}  `,
    ],
    youtube
  );
});

test('a video link that also names a playlist is still that video', () => {
  each(
    [
      `https://www.youtube.com/watch?v=${VIDEO}&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf`,
      `https://youtu.be/${VIDEO}?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf`,
    ],
    youtube
  );
});

test('a playlist-only YouTube link is flagged and has no video id', () => {
  each(
    [
      'https://www.youtube.com/playlist?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf',
      'https://www.youtube.com/watch?list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf',
      'https://music.youtube.com/playlist?list=OLAK5uy_kR3UbUk3mPH6KFYZCcd7s1FoXtNYBZYBo',
    ],
    { kind: 'youtube', videoId: null, playlistOnly: true }
  );
});

test('YouTube ids keep their case', () => {
  assert.equal(classifyLink('https://youtu.be/AbCdEfGhIjk').videoId, 'AbCdEfGhIjk');
  assert.equal(classifyLink('https://youtu.be/abcdefghijk').videoId, 'abcdefghijk');
});

test('Spotify track links carry the track id', () => {
  each(
    [
      `https://open.spotify.com/track/${TRACK}`,
      `https://open.spotify.com/track/${TRACK}?si=0123456789abcdef`,
      `https://open.spotify.com/intl-es/track/${TRACK}`,
      `https://open.spotify.com/intl-pt/track/${TRACK}?si=0123456789abcdef&nd=1`,
      `http://open.spotify.com/track/${TRACK}/`,
    ],
    spotify
  );
});

test('a spotify.link short link carries its code', () => {
  assert.deepEqual(classifyLink('https://spotify.link/AbCd1234XyZ'), { kind: 'spotify', shortCode: 'AbCd1234XyZ' });
});

test('SoundCloud track links are recognized', () => {
  each(
    [
      'https://soundcloud.com/some-artist/some-track',
      'https://www.soundcloud.com/some-artist/some-track',
      'https://m.soundcloud.com/some-artist/some-track',
      'https://soundcloud.com/some-artist/some-track?si=abc123&utm_source=clipboard',
    ],
    { kind: 'soundcloud', user: 'some-artist', track: 'some-track' }
  );
  assert.deepEqual(classifyLink('https://on.soundcloud.com/AbCd1234'), { kind: 'soundcloud', shortCode: 'AbCd1234' });
});

test('a link without a scheme is recognized on a known host', () => {
  assert.deepEqual(classifyLink(`youtu.be/${VIDEO}`), youtube);
  assert.deepEqual(classifyLink(`www.youtube.com/watch?v=${VIDEO}`), youtube);
  assert.deepEqual(classifyLink(`open.spotify.com/track/${TRACK}`), spotify);
  assert.deepEqual(classifyLink('soundcloud.com/some-artist/some-track'), {
    kind: 'soundcloud',
    user: 'some-artist',
    track: 'some-track',
  });
});

test('other web links are "other"', () => {
  each(
    [
      'https://example.com/',
      'https://music.apple.com/us/album/some-album/1234567890?i=1234567891',
      'https://tidal.com/browse/track/12345',
      // Known hosts, but not a single track or video.
      'https://www.youtube.com/',
      'https://www.youtube.com/@SomeChannel',
      'https://www.youtube.com/embed/videoseries',
      'https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3',
      'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
      'https://soundcloud.com/some-artist',
      'https://soundcloud.com/some-artist/sets/some-set',
      // Ids that do not match their pattern.
      'https://www.youtube.com/watch?v=tooshort',
      `https://www.youtube.com/watch?v=${VIDEO}extra`,
      'https://youtu.be/has.a.dot.1',
      `https://open.spotify.com/track/${TRACK.slice(1)}`,
      `https://open.spotify.com/track/${TRACK.slice(1)}-`,
      'https://spotify.link/has-a-dash',
      'https://spotify.link/a/b',
    ],
    { kind: 'other' }
  );
});

test('look-alike hosts are not the real service', () => {
  each(
    [
      `https://youtube.com.example.com/watch?v=${VIDEO}`,
      `https://notyoutube.com/watch?v=${VIDEO}`,
      `https://youtube.com@example.com/watch?v=${VIDEO}`,
      `https://example.com/watch?v=${VIDEO}`,
      `https://example.com/?next=https://youtu.be/${VIDEO}`,
      `https://example.com/https://youtu.be/${VIDEO}`,
      `https://youtu.be.example.com/${VIDEO}`,
      `https://open.spotify.com.example.com/track/${TRACK}`,
      `https://example.com/open.spotify.com/track/${TRACK}`,
      `https://spotify.com/track/${TRACK}`,
      'https://spotify.link.example.com/AbCd1234XyZ',
      'https://soundcloud.com.example.com/some-artist/some-track',
    ],
    { kind: 'other' }
  );
});

test('a link among other words stays a text search', () => {
  each(
    [
      `check this out https://youtu.be/${VIDEO}`,
      `https://youtu.be/${VIDEO} rick astley`,
      `Never Gonna Give You Up https://open.spotify.com/track/${TRACK}`,
      `https://youtu.be/${VIDEO} https://youtu.be/${VIDEO}`,
      `https://youtu.be/${VIDEO}\nhttps://open.spotify.com/track/${TRACK}`,
    ],
    { kind: null }
  );
});

test('ordinary text stays a text search', () => {
  each(
    [
      'never gonna give you up',
      'mr.brightside',
      'AC/DC',
      'will.i.am',
      '24/7',
      'P!nk',
      '100%',
      'youtube',
      'youtube.com',
      'youtu.be',
      'spotify.link',
      'soundcloud.com/some-artist',
      'www.example.com/some/page',
      `youtube.com.example.com/watch?v=${VIDEO}`,
      'youtu.be/tooshort',
      'ftp://example.com/file',
      `javascript:alert('${VIDEO}')`,
      'https://',
      'http:',
      '',
      '   ',
    ],
    { kind: null }
  );
});

test('a query that is not a string is not a link', () => {
  each([undefined, null, 42, {}, ['https://youtu.be/dQw4w9WgXcQ']], { kind: null });
});
