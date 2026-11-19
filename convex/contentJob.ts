/**
 * Weekly job behind the published content pages.
 *
 *   npx convex run contentJob:runWeekly
 *   npx convex run contentJob:runWeekly '{"week":"2026-W47"}'
 *
 * runWeekly is an action. Each step below is its own small query or mutation,
 * so no single transaction reads more than one page of songStats:
 *   1. page through songStats and total every song and artist;
 *   2. look up new song candidates on MusicBrainz and insert each one as live
 *      or held (publishSong);
 *   3. lift artists that now have enough picks and a live song;
 *   4. store the stats shown on every published song and artist page;
 *   5. compute and store the week's chart, then the week's baseline.
 *
 * Running a week again replaces its chart, baseline and stats and keeps its
 * note. The job only ever inserts publishedSongs and publishedArtists rows or
 * lifts a "below_bar" artist: it never deletes a row, never sets one to held
 * and never changes a slug.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type MutationCtx } from "./_generated/server";
import {
  artistPageStatsFields,
  baselineSongValidator,
  chartListsValidator,
  publishStatusValidator,
  songPageStatsFields,
} from "./schema";
import { isBlocked } from "./contentBlocklist";
import {
  BASELINE_MIN_PICKS,
  artistSlugBase,
  computeLists,
  decideSong,
  firstFreeSlug,
  isArtistCandidate,
  isSongCandidate,
  isWeekId,
  songSlugBase,
  splitSongKey,
  topPrompts,
  weekIdFor,
  type ArtistTotals,
  type ChartLists,
  type SongTotals,
} from "./contentLib";
import { lookupRecording, makePacer } from "./musicBrainz";

// A run labels the ISO week that holds the moment this long before it starts.
// The Monday cron therefore closes the week that just ended. A run by hand
// later in the week writes the week in progress, and the next Monday cron
// replaces it.
export const WEEK_CLOSE_GRACE_MS = 24 * 60 * 60 * 1000;

const STATS_PAGE = 500;
const PUBLISHED_PAGE = 500;
const WRITE_BATCH = 100;
const BASELINE_CHUNK = 1000;

// MusicBrainz lookups stop at whichever comes first, well inside the ten
// minute action limit. Candidates left over stay unpublished and are picked
// up by the follow-up pass or by next week's run.
export const MAX_LOOKUPS_PER_RUN = 240;
const LOOKUP_BUDGET_MS = 5 * 60 * 1000;
const MAX_CONSECUTIVE_FAILURES = 5;
// A run that published something and still has candidates left schedules
// itself again for the same week, at most this many passes in a row.
const MAX_PASSES = 5;
const NEXT_PASS_DELAY_MS = 2 * 60 * 1000;

type StatsRow = SongTotals & { songKey: string; prompt: string | null };
type StatsPage = { rows: StatsRow[]; cursor: string | null };
type PublishedSong = { songKey: string; slug: string; artistSlug: string; status: "live" | "held" };
type PublishedArtist = {
  artistKey: string;
  slug: string;
  status: "live" | "held";
  heldReason: "below_bar" | "filtered" | "manual" | null;
};

/** One page of songStats in creation order, without the stored names. */
export const statsPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }): Promise<StatsPage> => {
    const page = await ctx.db.query("songStats").paginate({ cursor, numItems: STATS_PAGE });
    return {
      rows: page.page.map((r) => ({
        songKey: r.songKey,
        prompt: r.prompt ?? null,
        picks: r.picks,
        wins: r.wins,
        ratingCount: r.ratingCount,
        ratingSum: r.ratingSum,
        ratingHist: r.ratingHist,
      })),
      cursor: page.isDone ? null : page.continueCursor,
    };
  },
});

export const publishedSongsPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }): Promise<{ rows: PublishedSong[]; cursor: string | null }> => {
    const page = await ctx.db.query("publishedSongs").paginate({ cursor, numItems: PUBLISHED_PAGE });
    return {
      rows: page.page.map((r) => ({
        songKey: r.songKey,
        slug: r.slug,
        artistSlug: r.artistSlug,
        status: r.status,
      })),
      cursor: page.isDone ? null : page.continueCursor,
    };
  },
});

export const publishedArtistsPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }): Promise<{ rows: PublishedArtist[]; cursor: string | null }> => {
    const page = await ctx.db.query("publishedArtists").paginate({ cursor, numItems: PUBLISHED_PAGE });
    return {
      rows: page.page.map((r) => ({
        artistKey: r.artistKey,
        slug: r.slug,
        status: r.status,
        heldReason: r.heldReason ?? null,
      })),
      cursor: page.isDone ? null : page.continueCursor,
    };
  },
});

const slugTaken = (ctx: MutationCtx, table: "publishedSongs" | "publishedArtists") => async (slug: string) =>
  (await ctx.db
    .query(table)
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .first()) !== null;

/**
 * Inserts one new publishedSongs row and, when its artist has none yet, the
 * publishedArtists row it points at. A song key that already has a row is left
 * exactly as it is. A new artist row starts held: "filtered" when its name
 * holds a blocked term, otherwise "below_bar".
 */
export const publishSong = internalMutation({
  args: {
    songKey: v.string(),
    title: v.string(),
    artist: v.string(),
    year: v.optional(v.number()),
    mbid: v.optional(v.string()),
    status: publishStatusValidator,
    heldReason: v.optional(v.union(v.literal("no_match"), v.literal("filtered"))),
  },
  handler: async (ctx, args): Promise<{ song: PublishedSong; artist: PublishedArtist }> => {
    const { artistKey } = splitSongKey(args.songKey);
    const now = Date.now();
    const artistView = (a: Doc<"publishedArtists">): PublishedArtist => ({
      artistKey: a.artistKey,
      slug: a.slug,
      status: a.status,
      heldReason: a.heldReason ?? null,
    });

    const existing = await ctx.db
      .query("publishedSongs")
      .withIndex("by_songKey", (q) => q.eq("songKey", args.songKey))
      .unique();
    if (existing) {
      const artist = await ctx.db
        .query("publishedArtists")
        .withIndex("by_slug", (q) => q.eq("slug", existing.artistSlug))
        .unique();
      if (!artist) throw new Error(`Published song ${existing.slug} has no artist row`);
      return {
        song: {
          songKey: existing.songKey,
          slug: existing.slug,
          artistSlug: existing.artistSlug,
          status: existing.status,
        },
        artist: artistView(artist),
      };
    }

    let artist = await ctx.db
      .query("publishedArtists")
      .withIndex("by_artistKey", (q) => q.eq("artistKey", artistKey))
      .unique();
    if (!artist) {
      const artistSlug = await firstFreeSlug(
        artistSlugBase(args.artist, artistKey),
        slugTaken(ctx, "publishedArtists")
      );
      const id = await ctx.db.insert("publishedArtists", {
        artistKey,
        slug: artistSlug,
        name: args.artist,
        status: "held",
        heldReason: isBlocked(artistKey) || isBlocked(args.artist) ? "filtered" : "below_bar",
        publishedAt: now,
      });
      artist = (await ctx.db.get(id))!;
    } else if (args.mbid && artist.name === artist.artistKey && artist.name !== args.artist) {
      // The row was created for an unmatched song and still shows the key
      // half; this is the first MusicBrainz name for the artist.
      await ctx.db.patch(artist._id, { name: args.artist });
    }

    const slug = await firstFreeSlug(
      songSlugBase(args.title, args.artist, args.songKey),
      slugTaken(ctx, "publishedSongs")
    );
    await ctx.db.insert("publishedSongs", {
      songKey: args.songKey,
      slug,
      title: args.title,
      artist: args.artist,
      artistSlug: artist.slug,
      year: args.year,
      mbid: args.mbid,
      status: args.status,
      heldReason: args.heldReason,
      publishedAt: now,
    });
    return {
      song: { songKey: args.songKey, slug, artistSlug: artist.slug, status: args.status },
      artist: artistView(artist),
    };
  },
});

/** Sets "below_bar" artists live. Rows held for any other reason are left alone. */
export const liftArtists = internalMutation({
  args: { slugs: v.array(v.string()) },
  handler: async (ctx, { slugs }): Promise<string[]> => {
    const lifted: string[] = [];
    for (const slug of slugs) {
      const row = await ctx.db
        .query("publishedArtists")
        .withIndex("by_slug", (q) => q.eq("slug", slug))
        .unique();
      if (!row || row.status !== "held" || row.heldReason !== "below_bar") continue;
      await ctx.db.patch(row._id, { status: "live", heldReason: undefined });
      lifted.push(slug);
    }
    return lifted;
  },
});

export const storeSongStats = internalMutation({
  args: { computedAt: v.number(), rows: v.array(v.object(songPageStatsFields)) },
  handler: async (ctx, { computedAt, rows }) => {
    for (const row of rows) {
      const existing = await ctx.db
        .query("publishedSongStats")
        .withIndex("by_slug", (q) => q.eq("slug", row.slug))
        .unique();
      if (existing) await ctx.db.replace(existing._id, { ...row, computedAt });
      else await ctx.db.insert("publishedSongStats", { ...row, computedAt });
    }
  },
});

export const storeArtistStats = internalMutation({
  args: { computedAt: v.number(), rows: v.array(v.object(artistPageStatsFields)) },
  handler: async (ctx, { computedAt, rows }) => {
    for (const row of rows) {
      const existing = await ctx.db
        .query("publishedArtistStats")
        .withIndex("by_slug", (q) => q.eq("slug", row.slug))
        .unique();
      if (existing) await ctx.db.replace(existing._id, { ...row, computedAt });
      else await ctx.db.insert("publishedArtistStats", { ...row, computedAt });
    }
  },
});

/** The latest week before `week` that has a baseline, or null. */
export const priorBaselineWeek = internalQuery({
  args: { week: v.string() },
  handler: async (ctx, { week }): Promise<string | null> => {
    const row = await ctx.db
      .query("chartBaselines")
      .withIndex("by_week_and_chunk", (q) => q.lt("week", week))
      .order("desc")
      .first();
    return row?.week ?? null;
  },
});

export const baselineChunk = internalQuery({
  args: { week: v.string(), chunk: v.number() },
  handler: async (ctx, { week, chunk }) => {
    const row = await ctx.db
      .query("chartBaselines")
      .withIndex("by_week_and_chunk", (q) => q.eq("week", week).eq("chunk", chunk))
      .unique();
    return row?.songs ?? null;
  },
});

export const storeBaselineChunk = internalMutation({
  args: { week: v.string(), chunk: v.number(), songs: v.array(baselineSongValidator) },
  handler: async (ctx, { week, chunk, songs }) => {
    const existing = await ctx.db
      .query("chartBaselines")
      .withIndex("by_week_and_chunk", (q) => q.eq("week", week).eq("chunk", chunk))
      .unique();
    if (existing) await ctx.db.patch(existing._id, { songs });
    else await ctx.db.insert("chartBaselines", { week, chunk, songs });
  },
});

/** Drops the chunks of a week's earlier, longer baseline. */
export const trimBaseline = internalMutation({
  args: { week: v.string(), chunks: v.number() },
  handler: async (ctx, { week, chunks }) => {
    const extra = await ctx.db
      .query("chartBaselines")
      .withIndex("by_week_and_chunk", (q) => q.eq("week", week).gte("chunk", chunks))
      .take(100);
    for (const row of extra) await ctx.db.delete(row._id);
  },
});

/** Writes a week's lists. An existing week keeps its note and note status. */
export const storeChart = internalMutation({
  args: { week: v.string(), computedAt: v.number(), lists: chartListsValidator },
  handler: async (ctx, { week, computedAt, lists }) => {
    const existing = await ctx.db
      .query("chartWeeks")
      .withIndex("by_week", (q) => q.eq("week", week))
      .unique();
    if (existing) await ctx.db.patch(existing._id, { computedAt, lists });
    else await ctx.db.insert("chartWeeks", { week, computedAt, lists, noteStatus: "none" });
  },
});

export type WeeklySummary = {
  week: string;
  songsScanned: number;
  candidates: number; // songs past the bar with no row before this run
  published: { slug: string; status: "live" | "held"; heldReason: string | null }[];
  carriedOver: number; // candidates still without a row
  artistsLifted: string[];
  lists: { [K in keyof ChartLists]: number | null };
  nextPassScheduled: boolean;
};

export const runWeekly = internalAction({
  args: {
    // ISO week id to write. Defaults to the week WEEK_CLOSE_GRACE_MS ago.
    week: v.optional(v.string()),
    // Set by the job when it schedules itself again for the same week.
    pass: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<WeeklySummary> => {
    const startedAt = Date.now();
    const week = args.week ?? weekIdFor(startedAt - WEEK_CLOSE_GRACE_MS);
    if (!isWeekId(week)) throw new Error(`Not an ISO week id: ${week}`);
    const pass = args.pass ?? 1;

    // 1. Totals. Rows are keyed as they arrive, so a row can only count once.
    const songs = new Map<string, SongTotals>();
    const songPrompts = new Map<string, Map<string, number>>();
    for (let cursor: string | null = null; ; ) {
      const page: StatsPage = await ctx.runQuery(internal.contentJob.statsPage, { cursor });
      for (const { songKey, prompt, ...totals } of page.rows) {
        if (prompt === null) {
          songs.set(songKey, totals);
        } else {
          let byPrompt = songPrompts.get(songKey);
          if (!byPrompt) songPrompts.set(songKey, (byPrompt = new Map()));
          byPrompt.set(prompt, totals.picks);
        }
      }
      if (page.cursor === null) break;
      cursor = page.cursor;
    }

    const artists = new Map<string, ArtistTotals>();
    for (const [songKey, t] of songs) {
      const { artistKey } = splitSongKey(songKey);
      const a = artists.get(artistKey) ?? { picks: 0, ratingCount: 0, ratingSum: 0 };
      a.picks += t.picks;
      a.ratingCount += t.ratingCount;
      a.ratingSum += t.ratingSum;
      artists.set(artistKey, a);
    }
    const artistPrompts = new Map<string, Map<string, number>>();
    for (const [songKey, byPrompt] of songPrompts) {
      const { artistKey } = splitSongKey(songKey);
      let total = artistPrompts.get(artistKey);
      if (!total) artistPrompts.set(artistKey, (total = new Map()));
      for (const [prompt, picks] of byPrompt) total.set(prompt, (total.get(prompt) ?? 0) + picks);
    }

    const publishedSongs = new Map<string, PublishedSong>(); // by songKey
    for (let cursor: string | null = null; ; ) {
      const page: { rows: PublishedSong[]; cursor: string | null } = await ctx.runQuery(
        internal.contentJob.publishedSongsPage,
        { cursor }
      );
      for (const row of page.rows) publishedSongs.set(row.songKey, row);
      if (page.cursor === null) break;
      cursor = page.cursor;
    }
    const publishedArtists = new Map<string, PublishedArtist>(); // by artistKey
    for (let cursor: string | null = null; ; ) {
      const page: { rows: PublishedArtist[]; cursor: string | null } = await ctx.runQuery(
        internal.contentJob.publishedArtistsPage,
        { cursor }
      );
      for (const row of page.rows) publishedArtists.set(row.artistKey, row);
      if (page.cursor === null) break;
      cursor = page.cursor;
    }

    // 2. New song candidates, most rated first.
    const candidates = [...songs]
      .filter(([songKey, t]) => isSongCandidate(t) && !publishedSongs.has(songKey))
      .sort((a, b) => b[1].ratingCount - a[1].ratingCount || (a[0] < b[0] ? -1 : 1))
      .map(([songKey]) => songKey);
    const published: WeeklySummary["published"] = [];
    const pace = makePacer();
    let lookups = 0;
    let failures = 0;
    for (const songKey of candidates) {
      if (
        lookups >= MAX_LOOKUPS_PER_RUN ||
        failures >= MAX_CONSECUTIVE_FAILURES ||
        Date.now() - startedAt > LOOKUP_BUDGET_MS
      ) {
        break;
      }
      lookups++;
      await pace();
      const result = await lookupRecording(songKey);
      if (result.kind === "unavailable") {
        failures++;
        await pace(); // a refused request doubles the gap before the next one
        continue;
      }
      failures = 0;
      const decision = decideSong(songKey, result.kind === "match" ? result.match : null);
      const row: { song: PublishedSong; artist: PublishedArtist } = await ctx.runMutation(
        internal.contentJob.publishSong,
        { songKey, ...decision }
      );
      publishedSongs.set(songKey, row.song);
      publishedArtists.set(row.artist.artistKey, row.artist);
      published.push({
        slug: row.song.slug,
        status: row.song.status,
        heldReason: decision.heldReason ?? null,
      });
    }
    const carriedOver = candidates.length - published.length;

    // 3. Artists that now clear the bar and have a live song.
    const artistsWithLiveSong = new Set<string>();
    for (const song of publishedSongs.values()) {
      if (song.status === "live") artistsWithLiveSong.add(song.artistSlug);
    }
    const toLift = [...publishedArtists.values()]
      .filter((a) => {
        const totals = artists.get(a.artistKey);
        return (
          a.status === "held" &&
          a.heldReason === "below_bar" &&
          totals !== undefined &&
          isArtistCandidate(totals) &&
          artistsWithLiveSong.has(a.slug)
        );
      })
      .map((a) => a.slug);
    const artistsLifted: string[] = [];
    for (let i = 0; i < toLift.length; i += WRITE_BATCH) {
      const lifted: string[] = await ctx.runMutation(internal.contentJob.liftArtists, {
        slugs: toLift.slice(i, i + WRITE_BATCH),
      });
      artistsLifted.push(...lifted);
    }
    const liftedSet = new Set(artistsLifted);
    for (const a of publishedArtists.values()) {
      if (liftedSet.has(a.slug)) {
        a.status = "live";
        a.heldReason = null;
      }
    }

    // 4. Page stats for every published row, live or held, so a row set live
    // by hand has its numbers ready.
    const computedAt = Date.now();
    const picksDescending = [...songs.values()].map((t) => t.picks).sort((a, b) => b - a);
    const rankByPicks = new Map<number, number>();
    picksDescending.forEach((picks, i) => {
      if (!rankByPicks.has(picks)) rankByPicks.set(picks, i + 1);
    });

    const songRows = [...publishedSongs.values()].flatMap((song) => {
      const t = songs.get(song.songKey);
      if (!t) return [];
      return [
        {
          slug: song.slug,
          ...t,
          rank: rankByPicks.get(t.picks) ?? picksDescending.length,
          topPrompts: topPrompts(songPrompts.get(song.songKey)),
        },
      ];
    });
    for (let i = 0; i < songRows.length; i += WRITE_BATCH) {
      await ctx.runMutation(internal.contentJob.storeSongStats, {
        computedAt,
        rows: songRows.slice(i, i + WRITE_BATCH),
      });
    }
    const artistRows = [...publishedArtists.values()].flatMap((artist) => {
      const t = artists.get(artist.artistKey);
      if (!t) return [];
      return [{ slug: artist.slug, ...t, topPrompts: topPrompts(artistPrompts.get(artist.artistKey)) }];
    });
    for (let i = 0; i < artistRows.length; i += WRITE_BATCH) {
      await ctx.runMutation(internal.contentJob.storeArtistStats, {
        computedAt,
        rows: artistRows.slice(i, i + WRITE_BATCH),
      });
    }

    // 5. Chart from live rows only, against the latest earlier baseline.
    let priorPicks: Map<string, number> | null = null;
    const priorWeek: string | null = await ctx.runQuery(internal.contentJob.priorBaselineWeek, { week });
    if (priorWeek !== null) {
      priorPicks = new Map();
      for (let chunk = 0; ; chunk++) {
        const rows: { songKey: string; picks: number }[] | null = await ctx.runQuery(
          internal.contentJob.baselineChunk,
          { week: priorWeek, chunk }
        );
        if (rows === null) break;
        for (const row of rows) priorPicks.set(row.songKey, row.picks);
      }
    }
    const lists = computeLists(
      [...publishedSongs.values()].flatMap((song) => {
        const totals = songs.get(song.songKey);
        return song.status === "live" && totals ? [{ slug: song.slug, songKey: song.songKey, totals }] : [];
      }),
      [...publishedArtists.values()].flatMap((artist) => {
        const totals = artists.get(artist.artistKey);
        return artist.status === "live" && totals && artistsWithLiveSong.has(artist.slug)
          ? [{ slug: artist.slug, picks: totals.picks }]
          : [];
      }),
      priorPicks
    );
    await ctx.runMutation(internal.contentJob.storeChart, { week, computedAt, lists });

    const baseline = [...songs]
      .filter(([, t]) => t.picks >= BASELINE_MIN_PICKS)
      .map(([songKey, t]) => ({ songKey, picks: t.picks, ratingCount: t.ratingCount }))
      .sort((a, b) => (a.songKey < b.songKey ? -1 : 1));
    const chunks = Math.ceil(baseline.length / BASELINE_CHUNK);
    for (let chunk = 0; chunk < chunks; chunk++) {
      await ctx.runMutation(internal.contentJob.storeBaselineChunk, {
        week,
        chunk,
        songs: baseline.slice(chunk * BASELINE_CHUNK, (chunk + 1) * BASELINE_CHUNK),
      });
    }
    await ctx.runMutation(internal.contentJob.trimBaseline, { week, chunks });

    const nextPassScheduled = carriedOver > 0 && published.length > 0 && pass < MAX_PASSES;
    if (nextPassScheduled) {
      await ctx.scheduler.runAfter(NEXT_PASS_DELAY_MS, internal.contentJob.runWeekly, {
        week,
        pass: pass + 1,
      });
    }

    return {
      week,
      songsScanned: songs.size,
      candidates: candidates.length,
      published,
      carriedOver,
      artistsLifted,
      lists: {
        mostPickedSongs: lists.mostPickedSongs.length,
        mostPickedArtists: lists.mostPickedArtists.length,
        highestRated: lists.highestRated.length,
        mostDivisive: lists.mostDivisive.length,
        movers: lists.movers === null ? null : lists.movers.length,
      },
      nextPassScheduled,
    };
  },
});
