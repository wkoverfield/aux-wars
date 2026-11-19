/**
 * Test data in the wire shape of the `content:published` query, one array
 * per section (see loadContent.js). Covers the cases the pages branch on:
 * a song whose artist has no page, an artist song with no page, a year that
 * is unknown, a latest week without an approved note, a week without movers.
 */
const songRow = (rank, slug, title, artist, artistSlug, value) => ({ rank, slug, title, artist, artistSlug, value });
const artistRow = (rank, slug, name, value) => ({ rank, slug, name, value });

export const SONGS = [
  {
    slug: "travis-scott-fe-n",
    title: "FE!N",
    artist: "Travis Scott",
    artistSlug: "travis-scott",
    year: 2023,
    picks: 1117,
    wins: 301,
    ratingCount: 3355,
    average: 3.416,
    ratingHist: [400, 520, 880, 955, 600],
    rank: 1,
    topPrompts: [
      { prompt: "A song that starts the mosh pit", picks: 53 },
      { prompt: "A song for the gym", picks: 1 },
    ],
  },
  {
    slug: "travis-scott-sicko-mode",
    title: "SICKO MODE",
    artist: "Travis Scott",
    artistSlug: "travis-scott",
    year: 2018,
    picks: 49,
    wins: 12,
    ratingCount: 140,
    average: 3.61,
    ratingHist: [10, 14, 36, 40, 40],
    rank: 2,
    topPrompts: [{ prompt: "A song everyone knows the words to", picks: 9 }],
  },
  {
    // The artist is below the artist bar: no /artist/sheck-wes page.
    slug: "sheck-wes-mo-bamba",
    title: "Mo Bamba",
    artist: "Sheck Wes",
    artistSlug: "sheck-wes",
    year: null,
    picks: 59,
    wins: 20,
    ratingCount: 61,
    average: 2.9,
    ratingHist: [15, 9, 14, 13, 10],
    rank: 3,
    topPrompts: [],
  },
];

export const ARTISTS = [
  {
    slug: "travis-scott",
    name: "Travis Scott",
    picks: 1318,
    ratingCount: 3900,
    average: 3.43,
    songs: [
      { slug: "travis-scott-sicko-mode", title: "SICKO MODE", picks: 49, ratingCount: 140, average: 3.61 },
      { slug: "travis-scott-fe-n", title: "FE!N", picks: 1117, ratingCount: 3355, average: 3.416 },
      // Not in SONGS: renders as plain text.
      { slug: "travis-scott-goosebumps", title: "goosebumps", picks: 31, ratingCount: 44, average: null },
    ],
    topPrompts: [{ prompt: "A song that starts the mosh pit", picks: 61 }],
  },
];

const lists = (movers) => ({
  mostPickedSongs: [
    songRow(1, "travis-scott-fe-n", "FE!N", "Travis Scott", "travis-scott", 1117),
    songRow(2, "sheck-wes-mo-bamba", "Mo Bamba", "Sheck Wes", "sheck-wes", 59),
  ],
  mostPickedArtists: [
    artistRow(1, "travis-scott", "Travis Scott", 1318),
    artistRow(2, "drake", "Drake", 461),
  ],
  highestRated: [songRow(1, "travis-scott-sicko-mode", "SICKO MODE", "Travis Scott", "travis-scott", 3.61)],
  mostDivisive: [songRow(1, "sheck-wes-mo-bamba", "Mo Bamba", "Sheck Wes", "sheck-wes", 1.4)],
  movers,
});

export const CHARTS = [
  {
    week: "2026-W46",
    weekStart: "2026-11-09",
    weekEnd: "2026-11-15",
    computedAt: 1794700800000,
    isLatest: false,
    note: "FE!N ran the week.\n\nMo Bamba split the room: nobody agrees on it.",
    approvedAt: 1794787200000,
    lists: lists(null),
  },
  {
    // Latest, note not approved yet: /charts shows it, no dated page.
    week: "2026-W47",
    weekStart: "2026-11-16",
    weekEnd: "2026-11-22",
    computedAt: 1795305600000,
    isLatest: true,
    note: null,
    approvedAt: null,
    lists: lists([songRow(1, "travis-scott-sicko-mode", "SICKO MODE", "Travis Scott", "travis-scott", 23)]),
  },
  {
    week: "2026-W45",
    weekStart: "2026-11-02",
    weekEnd: "2026-11-08",
    computedAt: 1794096000000,
    isLatest: false,
    note: "The first week of charts.",
    approvedAt: 1794182400000,
    lists: lists(null),
  },
];

export const CONTENT = { songs: SONGS, artists: ARTISTS, charts: CHARTS };
