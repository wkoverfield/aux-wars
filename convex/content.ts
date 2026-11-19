/**
 * Published content: the one public read behind the static chart, song and
 * artist pages, and the hand controls for it.
 *
 * Hand controls are internal, so only the CLI or dashboard can run them:
 *   npx convex run content:setSongStatus '{"slug":"hey-ya-outkast","status":"held"}'
 *   npx convex run content:setArtistStatus '{"slug":"outkast","status":"live"}'
 *   npx convex run content:setChartNote '{"week":"2026-W47","note":"..."}'
 *   npx convex run content:approveChartNote '{"week":"2026-W47"}'
 * (add --prod for production).
 *
 * `published` reads only the published tables and the stats the weekly job
 * copied for them (contentJob.ts). It never reads songStats, so it returns no
 * stored name, artist, albumCover or source of a song, and no song key.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { internalAction, internalMutation, query, type QueryCtx } from "./_generated/server";
import { publishStatusValidator, topPromptsValidator } from "./schema";
import { averageOf, isWeekId, weekRange } from "./contentLib";

const SONGS_PAGE = 100;
const ARTISTS_PAGE = 25;
const CHARTS_PAGE = 8;
// Most live songs read for one artist page, oldest rows first. With the page
// sizes above, no call reads more than a few thousand documents.
const MAX_ARTIST_SONGS = 100;
const MAX_NOTE = 5000;

const songItem = v.object({
  slug: v.string(),
  title: v.string(),
  artist: v.string(),
  artistSlug: v.string(),
  year: v.union(v.number(), v.null()),
  picks: v.number(),
  wins: v.number(),
  ratingCount: v.number(),
  average: v.union(v.number(), v.null()),
  ratingHist: v.array(v.number()),
  rank: v.number(),
  topPrompts: topPromptsValidator,
});

const artistItem = v.object({
  slug: v.string(),
  name: v.string(),
  picks: v.number(),
  ratingCount: v.number(),
  average: v.union(v.number(), v.null()),
  songs: v.array(
    v.object({
      slug: v.string(),
      title: v.string(),
      picks: v.number(),
      ratingCount: v.number(),
      average: v.union(v.number(), v.null()),
    })
  ),
  topPrompts: topPromptsValidator,
});

const chartSongRow = v.object({
  rank: v.number(),
  slug: v.string(),
  title: v.string(),
  artist: v.string(),
  artistSlug: v.string(),
  value: v.number(),
});
const chartArtistRow = v.object({
  rank: v.number(),
  slug: v.string(),
  name: v.string(),
  value: v.number(),
});
const chartItem = v.object({
  week: v.string(),
  weekStart: v.string(),
  weekEnd: v.string(),
  computedAt: v.number(),
  isLatest: v.boolean(),
  note: v.union(v.string(), v.null()),
  approvedAt: v.union(v.number(), v.null()),
  lists: v.object({
    mostPickedSongs: v.array(chartSongRow),
    mostPickedArtists: v.array(chartArtistRow),
    highestRated: v.array(chartSongRow),
    mostDivisive: v.array(chartSongRow),
    movers: v.union(v.array(chartSongRow), v.null()),
  }),
});

type ChartSongRow = typeof chartSongRow.type;
type ChartArtistRow = typeof chartArtistRow.type;
type StoredRow = { slug: string; value: number };

const bySlug = <T extends "publishedSongs" | "publishedArtists" | "publishedSongStats" | "publishedArtistStats">(
  ctx: QueryCtx,
  table: T,
  slug: string
) =>
  ctx.db
    .query(table)
    .withIndex("by_slug", (q) => q.eq("slug", slug as never))
    .unique() as Promise<Doc<T> | null>;

/**
 * Resolves stored chart rows against the rows that are live right now. A song
 * or artist held after the week was computed drops out, and the rows below it
 * move up.
 */
function chartResolver(ctx: QueryCtx) {
  const songs = new Map<string, Doc<"publishedSongs"> | null>();
  const artists = new Map<string, Doc<"publishedArtists"> | null>();

  const liveSong = async (slug: string) => {
    if (!songs.has(slug)) {
      const row = await bySlug(ctx, "publishedSongs", slug);
      songs.set(slug, row?.status === "live" ? row : null);
    }
    return songs.get(slug) ?? null;
  };
  const liveArtist = async (slug: string) => {
    if (!artists.has(slug)) {
      const row = await bySlug(ctx, "publishedArtists", slug);
      const hasLiveSong =
        row?.status === "live" &&
        (await ctx.db
          .query("publishedSongs")
          .withIndex("by_artistSlug_and_status", (q) => q.eq("artistSlug", slug).eq("status", "live"))
          .first()) !== null;
      artists.set(slug, row && hasLiveSong ? row : null);
    }
    return artists.get(slug) ?? null;
  };

  return {
    songRows: async (rows: StoredRow[]): Promise<ChartSongRow[]> => {
      const out: ChartSongRow[] = [];
      for (const { slug, value } of rows) {
        const song = await liveSong(slug);
        if (!song) continue;
        out.push({
          rank: out.length + 1,
          slug,
          title: song.title,
          artist: song.artist,
          artistSlug: song.artistSlug,
          value,
        });
      }
      return out;
    },
    artistRows: async (rows: StoredRow[]): Promise<ChartArtistRow[]> => {
      const out: ChartArtistRow[] = [];
      for (const { slug, value } of rows) {
        const artist = await liveArtist(slug);
        if (!artist) continue;
        out.push({ rank: out.length + 1, slug, name: artist.name, value });
      }
      return out;
    },
  };
}

/**
 * Public: one page of a section of the published content. Pass the returned
 * cursor back to read the next page; a null cursor means the last page.
 *
 *   songs    live songs with their stats.
 *   artists  live artists that have at least one live song, with those songs.
 *   charts   newest first: every week whose note is approved, plus the latest
 *            computed week (its note is null until approved).
 *
 * Over HTTP: POST {CONVEX_URL}/api/query with
 * {"path":"content:published","args":{"section":"songs"},"format":"json"}.
 */
export const published = query({
  args: {
    section: v.union(v.literal("songs"), v.literal("artists"), v.literal("charts")),
    cursor: v.optional(v.string()),
  },
  returns: v.object({
    items: v.array(v.union(songItem, artistItem, chartItem)),
    cursor: v.union(v.string(), v.null()),
  }),
  handler: async (ctx, { section, cursor }) => {
    const from = cursor ?? null;

    if (section === "songs") {
      const page = await ctx.db
        .query("publishedSongs")
        .withIndex("by_status", (q) => q.eq("status", "live"))
        .paginate({ cursor: from, numItems: SONGS_PAGE });
      const items: (typeof songItem.type)[] = [];
      for (const song of page.page) {
        const stats = await bySlug(ctx, "publishedSongStats", song.slug);
        if (!stats) continue; // inserted by a run that has not stored stats yet
        items.push({
          slug: song.slug,
          title: song.title,
          artist: song.artist,
          artistSlug: song.artistSlug,
          year: song.year ?? null,
          picks: stats.picks,
          wins: stats.wins,
          ratingCount: stats.ratingCount,
          average: averageOf(stats.ratingSum, stats.ratingCount),
          ratingHist: stats.ratingHist,
          rank: stats.rank,
          topPrompts: stats.topPrompts,
        });
      }
      return { items, cursor: page.isDone ? null : page.continueCursor };
    }

    if (section === "artists") {
      const page = await ctx.db
        .query("publishedArtists")
        .withIndex("by_status", (q) => q.eq("status", "live"))
        .paginate({ cursor: from, numItems: ARTISTS_PAGE });
      const items: (typeof artistItem.type)[] = [];
      for (const artist of page.page) {
        const stats = await bySlug(ctx, "publishedArtistStats", artist.slug);
        if (!stats) continue;
        const liveSongs = await ctx.db
          .query("publishedSongs")
          .withIndex("by_artistSlug_and_status", (q) => q.eq("artistSlug", artist.slug).eq("status", "live"))
          .take(MAX_ARTIST_SONGS);
        const songs: (typeof artistItem.type)["songs"] = [];
        for (const song of liveSongs) {
          const songStats = await bySlug(ctx, "publishedSongStats", song.slug);
          if (!songStats) continue;
          songs.push({
            slug: song.slug,
            title: song.title,
            picks: songStats.picks,
            ratingCount: songStats.ratingCount,
            average: averageOf(songStats.ratingSum, songStats.ratingCount),
          });
        }
        if (songs.length === 0) continue; // an artist is public only with a live song
        songs.sort((a, b) => b.picks - a.picks || (a.slug < b.slug ? -1 : 1));
        items.push({
          slug: artist.slug,
          name: artist.name,
          picks: stats.picks,
          ratingCount: stats.ratingCount,
          average: averageOf(stats.ratingSum, stats.ratingCount),
          songs,
          topPrompts: stats.topPrompts,
        });
      }
      return { items, cursor: page.isDone ? null : page.continueCursor };
    }

    const latest = await ctx.db.query("chartWeeks").withIndex("by_week").order("desc").first();
    const page = await ctx.db
      .query("chartWeeks")
      .withIndex("by_week")
      .order("desc")
      .paginate({ cursor: from, numItems: CHARTS_PAGE });
    const resolve = chartResolver(ctx);
    const items: (typeof chartItem.type)[] = [];
    for (const chart of page.page) {
      const approved = chart.noteStatus === "approved";
      const isLatest = chart.week === latest?.week;
      if (!approved && !isLatest) continue;
      items.push({
        week: chart.week,
        ...weekRange(chart.week),
        computedAt: chart.computedAt,
        isLatest,
        note: approved ? chart.note ?? null : null,
        approvedAt: approved ? chart.approvedAt ?? null : null,
        lists: {
          mostPickedSongs: await resolve.songRows(chart.lists.mostPickedSongs),
          mostPickedArtists: await resolve.artistRows(chart.lists.mostPickedArtists),
          highestRated: await resolve.songRows(chart.lists.highestRated),
          mostDivisive: await resolve.songRows(chart.lists.mostDivisive),
          movers: chart.lists.movers === null ? null : await resolve.songRows(chart.lists.movers),
        },
      });
    }
    return { items, cursor: page.isDone ? null : page.continueCursor };
  },
});

/** Internal: set a published song live or held. Its slug does not change. */
export const setSongStatus = internalMutation({
  args: { slug: v.string(), status: publishStatusValidator },
  handler: async (ctx, { slug, status }) => {
    const row = await ctx.db
      .query("publishedSongs")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!row) throw new Error(`No published song with slug "${slug}"`);
    if (row.status === status) return { slug, status, changed: false };
    await ctx.db.patch(row._id, { status, heldReason: status === "held" ? "manual" : undefined });
    return { slug, status, changed: true };
  },
});

/** Internal: set a published artist live or held. Its slug does not change. */
export const setArtistStatus = internalMutation({
  args: { slug: v.string(), status: publishStatusValidator },
  handler: async (ctx, { slug, status }) => {
    const row = await ctx.db
      .query("publishedArtists")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!row) throw new Error(`No published artist with slug "${slug}"`);
    if (row.status === status) return { slug, status, changed: false };
    await ctx.db.patch(row._id, { status, heldReason: status === "held" ? "manual" : undefined });
    return { slug, status, changed: true };
  },
});

const chartWeek = async (ctx: QueryCtx, week: string) => {
  if (!isWeekId(week)) throw new Error(`Not an ISO week id: ${week}`);
  const row = await ctx.db
    .query("chartWeeks")
    .withIndex("by_week", (q) => q.eq("week", week))
    .unique();
  if (!row) throw new Error(`No chart computed for ${week}`);
  return row;
};

/**
 * Internal: store a week's note as a draft. A draft is never public. Saving
 * over an approved note makes it a draft again; an empty note removes it.
 */
export const setChartNote = internalMutation({
  args: { week: v.string(), note: v.string() },
  handler: async (ctx, { week, note }) => {
    const row = await chartWeek(ctx, week);
    const text = note.trim();
    if (text.length > MAX_NOTE) throw new Error(`Note is longer than ${MAX_NOTE} characters`);
    if (!text) {
      await ctx.db.patch(row._id, { note: undefined, noteStatus: "none", approvedAt: undefined });
      return { week, noteStatus: "none" as const };
    }
    await ctx.db.patch(row._id, { note: text, noteStatus: "draft", approvedAt: undefined });
    return { week, noteStatus: "draft" as const };
  },
});

/**
 * Internal: approve a week's draft note, which makes it public, and schedule
 * a site rebuild. Approving an already approved note does nothing.
 */
export const approveChartNote = internalMutation({
  args: { week: v.string() },
  handler: async (ctx, { week }) => {
    const row = await chartWeek(ctx, week);
    if (row.noteStatus === "approved") return { week, approved: false, approvedAt: row.approvedAt ?? null };
    if (row.noteStatus !== "draft" || !row.note) throw new Error(`No draft note for ${week}`);
    const approvedAt = Date.now();
    await ctx.db.patch(row._id, { noteStatus: "approved", approvedAt });
    await ctx.scheduler.runAfter(0, internal.content.triggerDeploy, {});
    return { week, approved: true, approvedAt };
  },
});

/**
 * Internal: POST the Vercel deploy hook in VERCEL_DEPLOY_HOOK_URL so the
 * static pages rebuild. Does nothing when the variable is unset. The URL is a
 * secret and is never logged.
 */
export const triggerDeploy = internalAction({
  args: {},
  handler: async (): Promise<{ triggered: boolean; status: number | null }> => {
    const url = process.env.VERCEL_DEPLOY_HOOK_URL;
    if (!url) return { triggered: false, status: null };
    try {
      const res = await fetch(url, { method: "POST" });
      if (!res.ok) console.error(`Deploy hook answered ${res.status}`);
      return { triggered: res.ok, status: res.status };
    } catch {
      console.error("Deploy hook request failed");
      return { triggered: false, status: null };
    }
  },
});
