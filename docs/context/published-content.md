# Published content

The static chart, song and artist pages are built from the tables below. The
client build reads them through one public query, `content:published`.

## Tables

| Table | Holds |
| --- | --- |
| `publishedSongs` | One row per song that reached 50 ratings. `status` is `live` or `held`. |
| `publishedArtists` | One row per artist of a `publishedSongs` row. |
| `publishedSongStats`, `publishedArtistStats` | The numbers shown on a page, copied from `songStats` by the weekly job. |
| `chartWeeks` | One row per ISO week (`2026-W47`): the ranked lists and the week's note. |
| `chartBaselines` | Cumulative picks and rating counts of every song with 5 or more picks, per week, in chunks. |

Held reasons: `no_match` (MusicBrainz had no exact match), `filtered` (a word
from `convex/contentBlocklist.ts`), `manual` (set by hand), and for artists
`below_bar` (fewer than 50 picks, or no live song yet).

## Weekly job

`contentJob:runWeekly` is an internal action. A cron runs it every Monday at
10:00 UTC.

```
npx convex run contentJob:runWeekly
npx convex run contentJob:runWeekly '{"week":"2026-W47"}'
```

- Without `week`, a run writes the ISO week that holds the moment 24 hours
  before it. The Monday cron writes the week that just ended. A run later in
  the week writes the week in progress, and the next Monday cron replaces it.
- Running a week again replaces its lists, baseline and page stats, and keeps
  its note.
- Movers compare against the latest baseline of an earlier week. Without one,
  `movers` is `null`.
- New candidates are looked up on `musicbrainz.org`, one request every 1.1
  seconds, at most 240 per run. A run that published something and still has
  candidates left schedules itself again for the same week.
- The job inserts rows and lifts `below_bar` artists. It never deletes a row,
  never sets one to `held`, and never changes a slug.

## Hand controls

All internal: run them from the CLI or the dashboard. Add `--prod` for
production.

```
npx convex run content:setSongStatus '{"slug":"hey-ya-outkast","status":"held"}'
npx convex run content:setArtistStatus '{"slug":"outkast","status":"live"}'
npx convex run content:setChartNote '{"week":"2026-W47","note":"..."}'
npx convex run content:approveChartNote '{"week":"2026-W47"}'
npx convex run content:triggerDeploy
```

- `setChartNote` stores a draft. Saving over an approved note makes it a draft
  again. An empty note removes it.
- `approveChartNote` makes the note public and schedules `triggerDeploy`,
  which POSTs the URL in the `VERCEL_DEPLOY_HOOK_URL` environment variable and
  does nothing when it is unset.
- `contentSeed:seedDevSongStats` writes made-up rows into `songStats` for a
  dev deployment. Never run it against production.

## `content:published`

```
POST {CONVEX_URL}/api/query
{"path":"content:published","args":{"section":"songs"},"format":"json"}
```

Args: `{ section: "songs" | "artists" | "charts", cursor?: string }`.
Returns `{ items: [...], cursor: string | null }`. Pass `cursor` back to read
the next page; `null` means the last page. A page can hold fewer items than
the page size, or none, and still have a next page.

Song item:

```
{ slug, title, artist, artistSlug, year: number | null,
  picks, wins, ratingCount, average: number | null, ratingHist: [n1, n2, n3, n4, n5],
  rank, topPrompts: [{ prompt, picks }] }
```

Artist item:

```
{ slug, name, picks, ratingCount, average: number | null,
  songs: [{ slug, title, picks, ratingCount, average }],
  topPrompts: [{ prompt, picks }] }
```

Chart item:

```
{ week, weekStart, weekEnd, computedAt, isLatest, note: string | null, approvedAt: number | null,
  lists: { mostPickedSongs, mostPickedArtists, highestRated, mostDivisive, movers } }
```

Song rows are `{ rank, slug, title, artist, artistSlug, value }`. Artist rows
(`mostPickedArtists`) are `{ rank, slug, name, value }`. `value` is picks,
average rating, rating spread (standard deviation of the 1 to 5 ratings) or
picks gained, by list. `movers` is an array, or `null` when the week had no
earlier baseline.

- `average` has two decimals. `rank` is 1-based by picks among every song in
  `songStats`, published or not. `topPrompts` holds at most 8 entries.
- `songs` on an artist lists live songs only, most picked first. `picks` on an
  artist counts all of their songs, so it can exceed the sum of the list.
- `charts` returns, newest first, every week whose note is approved plus the
  latest computed week. `note` and `approvedAt` are `null` unless approved.
- `artistSlug` is always present, including when that artist has no live page.
  Link only to slugs returned by the `artists` section.
- `weekStart` and `weekEnd` are the Monday and Sunday of the ISO week, as UTC
  `YYYY-MM-DD`.

## Landmines

- Public names come from MusicBrainz. `content:published` reads only the
  published tables and must never return `songStats.name`, `songStats.artist`,
  `albumCover` or `sources`, a song key, an `mbid`, a held row or an
  unapproved note. The query has a `returns` validator; a new field has to be
  added there on purpose.
- A slug is used verbatim as a file name and a URL. It matches `[a-z0-9-]`, is
  at most 80 characters, and is permanent: changing one breaks a published URL.
- A held `no_match` song has no MusicBrainz names; its `title` and `artist`
  are the lower case halves of its song key. Setting it live by hand publishes
  those strings.
- Chart lists store slugs. A song or artist set to `held` after a week was
  computed drops out of that week's lists at read time, and the rows below it
  move up.
- A song is published once and its stats are refreshed only by the weekly
  job. Pages show the numbers as of the last run, not live counts.
- MusicBrainz allows one request per second and requires the `User-Agent` in
  `convex/musicBrainz.ts`. A 503 means busy: the song is left for a later run,
  not held.
