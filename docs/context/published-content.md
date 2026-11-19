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

A song is public when its row is `live` and its artist row is `live` or held
as `below_bar`. An artist held as `manual` or `filtered` takes every one of
their songs off the song pages, the chart rows and the artist lists. The
songs' own `status` does not change.

## MusicBrainz match

One search per song key returns up to 25 recordings (`pickRecording` in
`convex/musicBrainz.ts`).

- A recording belongs to the song when its title equals the title half of the
  key under `clean()`, and either its whole artist credit or its first
  credited name equals the artist half. `Travis Scott feat. Playboi Carti`
  belongs to a `travis scott|...` key; it does not belong to a
  `playboi carti|...` key.
- The song is matched when at least one of those recordings scores 90 or
  more (`MATCH_MIN_SCORE`). Otherwise it is held as `no_match`.
- The published recording is the earliest first release among those that
  score 70 or more (`PUBLISH_MIN_SCORE`). Equal dates go to the lowest
  `mbid`. `title`, `year` and `mbid` are that recording's.
- `artist` is the whole credit when it equals the artist half, otherwise the
  first credited name. It always equals the artist half under `clean()`, so a
  featured artist is never part of a published name.

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
- A run stores the totals as they are when it runs. `week` is accepted only
  when it is the week a run without it would write, or the ISO week in
  progress (the two differ during the first 24 hours of a week). Any other
  week throws and writes nothing.
- Running a week again replaces its lists, baseline and page stats, and keeps
  its note.
- Movers compare against the latest baseline of an earlier week. Without one,
  `movers` is `null`.
- New candidates are looked up on `musicbrainz.org`, one request every 1.1
  seconds, at most 240 per run. A run that published something and still has
  candidates left schedules itself again for the same week.
- A request answered 503 or 429, or not answered at all, is sent again after
  2, 4 and 8 seconds. A song whose lookup still fails gets no row, is listed
  by song key under `unresolved` in the run's return value, and is looked up
  again by the next run.
- The last pass of a run schedules `content:triggerDeploy`, so new pages and
  the new week reach the site without a note approval. A chart note is public
  only once it is approved.
- The job inserts rows and lifts `below_bar` artists. It never deletes a row,
  never sets one to `held`, and never changes a slug.

## Hand controls

All internal: run them from the CLI or the dashboard. Add `--prod` for
production.

```
npx convex run content:setSongStatus '{"slug":"hey-ya-outkast","status":"held"}'
npx convex run content:setArtistStatus '{"slug":"outkast","status":"live"}'
npx convex run content:setSongDetails '{"slug":"hey-ya-outkast","title":"Hey Ya!","artist":"OutKast","year":2003}'
npx convex run content:setArtistName '{"slug":"outkast","name":"OutKast"}'
npx convex run content:setChartNote '{"week":"2026-W47","note":"..."}'
npx convex run content:approveChartNote '{"week":"2026-W47"}'
npx convex run content:triggerDeploy
```

- `setSongDetails` takes any of `title`, `artist` and `year` and changes only
  those; `"year": null` removes the year. `artist` is the name shown with
  the song. The name on an artist page is set with `setArtistName`. Neither
  changes a slug, a status or `artistSlug`.
- A changed row reaches the site at the next build (`triggerDeploy`).
- `setChartNote` stores a draft. Saving over an approved note makes it a draft
  again. An empty note removes it.
- `approveChartNote` makes the note public and schedules `triggerDeploy`,
  which POSTs the URL in the `VERCEL_DEPLOY_HOOK_URL` environment variable and
  does nothing when it is unset.
- `setSongStatus` to `live` throws for a row without an `mbid` until
  `setSongDetails` has been given both `title` and `artist` (in one call or
  several). `setArtistStatus` to `live` throws for a row whose name did not
  come from MusicBrainz until `setArtistName` has been run for it.
- `contentSeed:seedDevSongStats` writes made-up rows into `songStats`. It
  throws unless the deployment's `ALLOW_CONTENT_SEED` environment variable is
  `1`.

## Environment variables

| Variable | Set on | Effect |
| --- | --- | --- |
| `VERCEL_DEPLOY_HOOK_URL` | production | URL that `triggerDeploy` POSTs. Unset: no rebuild is requested. |
| `ALLOW_CONTENT_SEED` | dev only | `1` lets `contentSeed:seedDevSongStats` run. Never set on production. |

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

- `average` has two decimals. `rank` is the song's 1-based place among the
  public songs, in the order of `mostPickedSongs` (picks, then rating count,
  then slug), as of the last run. `topPrompts` holds at most 8 entries.
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
  are the lower case halves of its song key, and so is the name of an artist
  row created for it. Those strings must never be public. `setSongStatus` and
  `setArtistStatus` refuse `live` until the row is named with
  `setSongDetails` or `setArtistName`.
- The weekly job writes `title`, `artist`, `year` and `mbid` once, when it
  inserts the row, and never looks a song up again. A wrong value stays until
  it is corrected by hand.
- A newly matched song renames its artist row only while that row's `name`
  still equals its `artistKey`.
- Chart lists store slugs. A song or artist set to `held` after a week was
  computed drops out of that week's lists at read time, and the rows below it
  move up. `rank` on a song page is not recomputed until the next run.
- A song is published once and its stats are refreshed only by the weekly
  job. Pages show the numbers as of the last run, not live counts.
- MusicBrainz allows one request per second and requires the `User-Agent` in
  `convex/musicBrainz.ts`. A 503 means busy: the song is left for a later run,
  not held. Retries wait on the same pacer as first requests.
