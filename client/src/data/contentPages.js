import { formatAverage, formatCount, formatDate, formatDateRange } from "./contentFormat.js";

/**
 * Turns the published content (the three sections of the `content:published`
 * Convex query, see src/prerender/loadContent.js) into the content pages the
 * build writes: one per live song, one per live artist, /charts for the
 * latest week and /charts/<week> for every week whose note is approved.
 *
 * Each page is `{ path, file, index, title, description, data }`, the same
 * fields as the static entries in pages.js plus `data`: the complete model
 * its component renders from. A model never refers back to the full data
 * set. Links are resolved here: a song or artist name carries an `href` only
 * when a page with that slug is in this build, and is plain text otherwise.
 *
 * Slugs and week ids become file names and URL segments verbatim, so anything
 * outside [a-z0-9-] or the ISO week form throws and fails the build.
 */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const WEEK = /^\d{4}-W\d{2}$/;

// The lists of a chart week, in page order. `movers` is null until a previous
// week exists to compare against, and is left out then.
export const CHART_LISTS = [
  { key: "movers", title: "Most picked this week" },
  { key: "mostPickedSongs", title: "Most picked songs" },
  { key: "mostPickedArtists", title: "Most picked artists" },
  { key: "highestRated", title: "Highest rated songs" },
  { key: "mostDivisive", title: "Most divisive songs" },
];

function slugOf(kind, slug) {
  if (typeof slug !== "string" || !SLUG.test(slug)) {
    throw new Error(`content: ${kind} has an invalid slug ${JSON.stringify(slug)}`);
  }
  return slug;
}

function unique(kind, items, keyOf) {
  const seen = new Set();
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) throw new Error(`content: duplicate ${kind} "${key}"`);
    seen.add(key);
  }
  return seen;
}

const songPath = (slug) => `/song/${slug}`;
const artistPath = (slug) => `/artist/${slug}`;
const weekPath = (week) => `/charts/${week.toLowerCase()}`;
const fileFor = (path) => `${path.slice(1)}.html`;

const byPicks = (a, b) => b.picks - a.picks || a.title.localeCompare(b.title, "en");

function songPage(song, songs, artistSlugs) {
  const path = songPath(song.slug);
  const average = formatAverage(song.average);
  const moreByArtist = songs
    .filter((other) => other.artistSlug === song.artistSlug && other.slug !== song.slug)
    .sort(byPicks)
    .map((other) => ({
      title: other.title,
      href: songPath(other.slug),
      picks: other.picks,
      average: other.average,
    }));
  return {
    path,
    file: fileFor(path),
    index: true,
    title: `${song.title} by ${song.artist}: Aux Battle Stats | Aux Wars`,
    description:
      `${song.title} by ${song.artist} has been picked ${formatCount(song.picks)} times in Aux Wars games` +
      (average ? `, with an average rating of ${average} out of 5 from ${formatCount(song.ratingCount)} ratings.` : "."),
    data: {
      kind: "song",
      path,
      title: song.title,
      artist: {
        name: song.artist,
        href: artistSlugs.has(song.artistSlug) ? artistPath(song.artistSlug) : null,
      },
      year: song.year ?? null,
      picks: song.picks,
      ratingCount: song.ratingCount,
      average: song.average ?? null,
      winRate: song.picks > 0 ? Math.round((song.wins / song.picks) * 100) : null,
      rank: song.rank,
      ratingHist: song.ratingHist,
      topPrompts: song.topPrompts ?? [],
      moreByArtist,
    },
  };
}

function artistPage(artist, songSlugs) {
  const path = artistPath(artist.slug);
  const average = formatAverage(artist.average);
  const songs = [...(artist.songs ?? [])].sort(byPicks).map((song, i) => ({
    rank: i + 1,
    title: song.title,
    href: songSlugs.has(song.slug) ? songPath(song.slug) : null,
    picks: song.picks,
    average: song.average ?? null,
  }));
  return {
    path,
    file: fileFor(path),
    index: true,
    title: `${artist.name}: Most Picked Songs in Aux Battles | Aux Wars`,
    description:
      `${artist.name} songs have been picked ${formatCount(artist.picks)} times in Aux Wars games` +
      (average ? `, with an average rating of ${average} out of 5.` : ".") +
      " See which songs get picked most and what prompts they get picked for.",
    data: {
      kind: "artist",
      path,
      name: artist.name,
      picks: artist.picks,
      ratingCount: artist.ratingCount,
      average: artist.average ?? null,
      songs,
      topPrompts: artist.topPrompts ?? [],
    },
  };
}

function chartRows(rows, songSlugs, artistSlugs) {
  return [...rows]
    .sort((a, b) => a.rank - b.rank)
    .map((row) =>
      "name" in row
        ? {
            rank: row.rank,
            title: row.name,
            href: artistSlugs.has(row.slug) ? artistPath(row.slug) : null,
            artist: null,
            value: row.value,
          }
        : {
            rank: row.rank,
            title: row.title,
            href: songSlugs.has(row.slug) ? songPath(row.slug) : null,
            artist: {
              name: row.artist,
              href: artistSlugs.has(row.artistSlug) ? artistPath(row.artistSlug) : null,
            },
            value: row.value,
          },
    );
}

function chartModel(week, path, otherWeeks, songSlugs, artistSlugs) {
  const lists = CHART_LISTS.filter(({ key }) => week.lists[key]?.length).map(({ key, title }) => ({
    key,
    title,
    rows: chartRows(week.lists[key], songSlugs, artistSlugs),
  }));
  return {
    kind: "charts",
    path,
    week: week.week,
    range: formatDateRange(week.weekStart, week.weekEnd),
    noteLabel: `Week of ${formatDate(week.weekStart)}`,
    note: week.note
      ? week.note.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean)
      : null,
    lists,
    weeksTitle: path === "/charts" ? "Earlier weeks" : "Other weeks",
    weeks: otherWeeks.map((other) => ({
      label: `Week of ${formatDate(other.weekStart)}`,
      href: weekPath(other.week),
    })),
  };
}

function topSongLine(week) {
  const top = week.lists.mostPickedSongs?.[0];
  return top ? ` Most picked: ${top.title} by ${top.artist}.` : "";
}

/** The homepage line: the top song of the week, or of all time before a second week exists. */
function homeLine(latest) {
  const mover = latest.lists.movers?.[0];
  if (mover) return { title: mover.title, artist: mover.artist, weekly: true };
  const top = latest.lists.mostPickedSongs?.[0];
  return top ? { title: top.title, artist: top.artist, weekly: false } : null;
}

/**
 * @param {{ songs: object[], artists: object[], charts: object[] }} content
 * @returns {{ pages: object[], home: object | null }}
 */
export function buildContentPages({ songs, artists, charts }) {
  const songSlugs = unique("song slug", songs, (song) => slugOf("song", song.slug));
  const artistSlugs = unique("artist slug", artists, (artist) => slugOf("artist", artist.slug));
  unique("chart week", charts, (week) => {
    if (typeof week.week !== "string" || !WEEK.test(week.week)) {
      throw new Error(`content: invalid chart week ${JSON.stringify(week.week)}`);
    }
    return week.week;
  });
  if (charts.length === 0) throw new Error("content: no chart week to publish at /charts");

  // Week ids sort as text: "2026-W47" > "2026-W46".
  const newestFirst = [...charts].sort((a, b) => (a.week < b.week ? 1 : -1));
  const latest = newestFirst.find((week) => week.isLatest) ?? newestFirst[0];
  const dated = newestFirst.filter((week) => week.note);

  const chartPages = [
    {
      path: "/charts",
      file: "charts.html",
      index: true,
      title: "Aux Wars Charts: The Most Picked Songs in Aux Battles This Week",
      description:
        `The songs and artists picked and rated most in Aux Wars games, ${formatDateRange(latest.weekStart, latest.weekEnd)}.` +
        topSongLine(latest),
      data: chartModel(
        latest,
        "/charts",
        dated.filter((week) => week.week < latest.week),
        songSlugs,
        artistSlugs,
      ),
    },
    ...dated.map((week) => {
      const path = weekPath(week.week);
      return {
        path,
        file: fileFor(path),
        index: true,
        title: `Aux Wars Charts: Week of ${formatDate(week.weekStart)}`,
        description:
          `The songs and artists picked and rated most in Aux Wars games, ${formatDateRange(week.weekStart, week.weekEnd)}.` +
          topSongLine(week),
        data: chartModel(
          week,
          path,
          dated.filter((other) => other.week !== week.week),
          songSlugs,
          artistSlugs,
        ),
      };
    }),
  ];

  return {
    pages: [
      ...chartPages,
      ...songs.map((song) => songPage(song, songs, artistSlugs)),
      ...artists.map((artist) => artistPage(artist, songSlugs)),
    ],
    home: homeLine(latest),
  };
}
