/**
 * Published content: the one public read behind the static chart, song and
 * artist pages, and the hand controls for it.
 *
 * Hand controls are internal, so only the CLI or dashboard can run them:
 *   npx convex run content:setSongStatus '{"slug":"hey-ya-outkast","status":"held"}'
 *   npx convex run content:setArtistStatus '{"slug":"outkast","status":"live"}'
 *   npx convex run content:setSongDetails '{"slug":"hey-ya-outkast","year":2003}'
 *   npx convex run content:setArtistName '{"slug":"outkast","name":"OutKast"}'
 *   npx convex run content:setChartNote '{"week":"2026-W47","note":"..."}'
 *   npx convex run content:approveChartNote '{"week":"2026-W47"}'
 *   npx convex run content:removeSongCover '{"slug":"hey-ya-outkast"}'
 *   npx convex run content:removeArtistPhoto '{"slug":"outkast"}'
 *   npx convex run content:setSongCoverFromUrl '{"slug":"hey-ya-outkast","url":"https://..."}'
 *   npx convex run content:setArtistPhotoFromUrl '{"slug":"outkast","url":"https://...","author":"...","license":"CC BY-SA 4.0","pageUrl":"https://commons.wikimedia.org/wiki/File:..."}'
 * (add --prod for production).
 *
 * `published` reads only the published tables and the stats the weekly job
 * copied for them (contentJob.ts). It never reads songStats, so it returns no
 * stored name, artist, albumCover or source of a song, and no song key. The
 * images it returns are files in Convex storage that came from the Cover Art
 * Archive or Wikimedia Commons (contentImages.ts).
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, query, type QueryCtx } from "./_generated/server";
import { publishStatusValidator, topPromptsValidator } from "./schema";
import { averageOf, hidesSongs, isWeekId, weekRange } from "./contentLib";
import { storeImage } from "./contentImages";
import { MAX_CREDIT, allowedUrl, commonsPageUrl, fetchImage, type ImageFile } from "./imageSources";
import { makePacer } from "./musicBrainz";

const SONGS_PAGE = 100;
const ARTISTS_PAGE = 25;
const CHARTS_PAGE = 8;
// Most live songs read for one artist page, oldest rows first. With the page
// sizes above, no call reads more than a few thousand documents.
const MAX_ARTIST_SONGS = 100;
const MAX_NOTE = 5000;
const MAX_NAME = 300;

const imageFields = { url: v.string(), width: v.number(), height: v.number() };

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
  image: v.union(v.object(imageFields), v.null()),
});

const artistItem = v.object({
  slug: v.string(),
  name: v.string(),
  image: v.union(
    v.object({
      ...imageFields,
      // The credit of a Commons photo. Null when the image is a song cover.
      credit: v.union(v.object({ author: v.string(), license: v.string(), pageUrl: v.string() }), v.null()),
    }),
    v.null()
  ),
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

/** A stored image as the pages use it, or null when there is none. */
async function storedImage(
  ctx: QueryCtx,
  storageId: Id<"_storage"> | undefined,
  width: number | undefined,
  height: number | undefined
) {
  if (!storageId || !width || !height) return null;
  const url = await ctx.storage.getUrl(storageId);
  return url ? { url, width, height } : null;
}

/**
 * Reports whether an artist slug takes its songs off the public pages
 * (hidesSongs), reading each artist row once.
 */
function songHider(ctx: QueryCtx) {
  const hidden = new Map<string, boolean>();
  return async (artistSlug: string): Promise<boolean> => {
    let answer = hidden.get(artistSlug);
    if (answer === undefined) {
      const artist = await bySlug(ctx, "publishedArtists", artistSlug);
      answer = artist !== null && hidesSongs(artist);
      hidden.set(artistSlug, answer);
    }
    return answer;
  };
}

/**
 * Resolves stored chart rows against the rows that are public right now. A
 * song or artist held after the week was computed drops out, and so does
 * every song of an artist that hides its songs; the rows below move up.
 */
function chartResolver(ctx: QueryCtx) {
  const songs = new Map<string, Doc<"publishedSongs"> | null>();
  const artists = new Map<string, Doc<"publishedArtists"> | null>();
  const hiddenByArtist = songHider(ctx);

  const liveSong = async (slug: string) => {
    if (!songs.has(slug)) {
      const row = await bySlug(ctx, "publishedSongs", slug);
      songs.set(slug, row?.status === "live" && !(await hiddenByArtist(row.artistSlug)) ? row : null);
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
 *   songs    live songs with their stats, except those of an artist held
 *            for any reason other than "below_bar".
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
      const hiddenByArtist = songHider(ctx);
      const items: (typeof songItem.type)[] = [];
      for (const song of page.page) {
        if (await hiddenByArtist(song.artistSlug)) continue;
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
          image: await storedImage(ctx, song.coverStorageId, song.coverWidth, song.coverHeight),
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
        const songDocs = new Map<string, Doc<"publishedSongs">>();
        for (const song of liveSongs) {
          const songStats = await bySlug(ctx, "publishedSongStats", song.slug);
          if (!songStats) continue;
          songDocs.set(song.slug, song);
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
        // The artist's own photo with its credit, else the cover of their
        // most picked live song.
        const photo = await storedImage(ctx, artist.photoStorageId, artist.photoWidth, artist.photoHeight);
        const top = songDocs.get(songs[0].slug);
        const cover = photo ? null : await storedImage(ctx, top?.coverStorageId, top?.coverWidth, top?.coverHeight);
        const credit =
          artist.photoAuthor && artist.photoLicense && artist.photoPageUrl
            ? { author: artist.photoAuthor, license: artist.photoLicense, pageUrl: artist.photoPageUrl }
            : null;
        items.push({
          slug: artist.slug,
          name: artist.name,
          // A photo without its credit is not shown.
          image: photo ? (credit ? { ...photo, credit } : null) : cover ? { ...cover, credit: null } : null,
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

/**
 * Internal: set a published song live or held. Its slug does not change.
 * A row without an mbid goes live only after setSongDetails has been given
 * both its title and its artist: until then they are the halves of its song
 * key, which must never be published.
 */
export const setSongStatus = internalMutation({
  args: { slug: v.string(), status: publishStatusValidator },
  handler: async (ctx, { slug, status }) => {
    const row = await ctx.db
      .query("publishedSongs")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!row) throw new Error(`No published song with slug "${slug}"`);
    if (row.status === status) return { slug, status, changed: false };
    if (status === "live" && !row.mbid && !(row.titleSetByHand && row.artistSetByHand)) {
      throw new Error(
        `Song "${slug}" has no confirmed title and artist. Set both with content:setSongDetails first.`
      );
    }
    await ctx.db.patch(row._id, { status, heldReason: status === "held" ? "manual" : undefined });
    return { slug, status, changed: true };
  },
});

/**
 * Internal: set a published artist live or held. Its slug does not change.
 * Held by hand, the artist's songs leave the public read as well; their own
 * status is not touched. A row whose name is still its artist key goes live
 * only after setArtistName.
 */
export const setArtistStatus = internalMutation({
  args: { slug: v.string(), status: publishStatusValidator },
  handler: async (ctx, { slug, status }) => {
    const row = await ctx.db
      .query("publishedArtists")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!row) throw new Error(`No published artist with slug "${slug}"`);
    if (row.status === status) return { slug, status, changed: false };
    if (status === "live" && !row.nameConfirmed) {
      throw new Error(`Artist "${slug}" has no confirmed name. Set it with content:setArtistName first.`);
    }
    await ctx.db.patch(row._id, { status, heldReason: status === "held" ? "manual" : undefined });
    return { slug, status, changed: true };
  },
});

// A title or name typed by hand: trimmed, not empty, at most MAX_NAME long.
function handName(field: string, value: string): string {
  const text = value.trim();
  if (!text) throw new Error(`${field} is empty`);
  if (text.length > MAX_NAME) throw new Error(`${field} is longer than ${MAX_NAME} characters`);
  return text;
}

/**
 * Internal: correct the title, artist or year shown for a published song.
 * Only the fields passed change; `year: null` removes the year. A title or
 * artist passed here counts as confirmed (see setSongStatus). The slug,
 * status and artistSlug do not change, and the weekly job never writes these
 * fields again. `artist` is the name shown with the song; the name on the
 * artist page is publishedArtists.name (setArtistName).
 */
export const setSongDetails = internalMutation({
  args: {
    slug: v.string(),
    title: v.optional(v.string()),
    artist: v.optional(v.string()),
    year: v.optional(v.union(v.number(), v.null())),
  },
  handler: async (ctx, { slug, title, artist, year }) => {
    const row = await ctx.db
      .query("publishedSongs")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!row) throw new Error(`No published song with slug "${slug}"`);
    if (year !== undefined && year !== null && !(Number.isInteger(year) && year >= 1000 && year <= 2100)) {
      throw new Error(`Not a release year: ${year}`);
    }
    const next = {
      title: title === undefined ? row.title : handName("title", title),
      artist: artist === undefined ? row.artist : handName("artist", artist),
      year: year === undefined ? row.year : year ?? undefined,
    };
    const changed = next.title !== row.title || next.artist !== row.artist || next.year !== row.year;
    // A field given by hand is confirmed, also when the text did not change.
    const confirmed = {
      titleSetByHand: title === undefined ? row.titleSetByHand : true,
      artistSetByHand: artist === undefined ? row.artistSetByHand : true,
    };
    const newlyConfirmed =
      confirmed.titleSetByHand !== row.titleSetByHand || confirmed.artistSetByHand !== row.artistSetByHand;
    if (changed || newlyConfirmed) await ctx.db.patch(row._id, { ...next, ...confirmed });
    return { slug, title: next.title, artist: next.artist, year: next.year ?? null, changed };
  },
});

/** Internal: correct the name shown for a published artist. Its slug does not change. */
export const setArtistName = internalMutation({
  args: { slug: v.string(), name: v.string() },
  handler: async (ctx, { slug, name }) => {
    const row = await ctx.db
      .query("publishedArtists")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!row) throw new Error(`No published artist with slug "${slug}"`);
    const text = handName("name", name);
    if (text === row.name) {
      if (!row.nameConfirmed) await ctx.db.patch(row._id, { nameConfirmed: true });
      return { slug, name: text, changed: false };
    }
    await ctx.db.patch(row._id, { name: text, nameConfirmed: true });
    return { slug, name: text, changed: true };
  },
});

/**
 * Internal: remove a song's cover and delete its file. The weekly job does
 * not fetch a cover for the song again.
 */
export const removeSongCover = internalMutation({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const row = await ctx.db
      .query("publishedSongs")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!row) throw new Error(`No published song with slug "${slug}"`);
    if (row.coverStorageId) await ctx.storage.delete(row.coverStorageId);
    await ctx.db.patch(row._id, {
      coverStorageId: undefined,
      coverWidth: undefined,
      coverHeight: undefined,
      coverSetByHand: true,
    });
    return { slug, removed: row.coverStorageId !== undefined };
  },
});

/**
 * Internal: remove an artist's photo and its credit and delete the file. The
 * weekly job does not fetch a photo for the artist again. The artist page
 * then shows the cover of their most picked live song, when it has one.
 */
export const removeArtistPhoto = internalMutation({
  args: { slug: v.string() },
  handler: async (ctx, { slug }) => {
    const row = await ctx.db
      .query("publishedArtists")
      .withIndex("by_slug", (q) => q.eq("slug", slug))
      .unique();
    if (!row) throw new Error(`No published artist with slug "${slug}"`);
    if (row.photoStorageId) await ctx.storage.delete(row.photoStorageId);
    await ctx.db.patch(row._id, {
      photoStorageId: undefined,
      photoWidth: undefined,
      photoHeight: undefined,
      photoAuthor: undefined,
      photoLicense: undefined,
      photoPageUrl: undefined,
      photoSetByHand: true,
    });
    return { slug, removed: row.photoStorageId !== undefined };
  },
});

// An image for a hand control: from an allowed host, checked like the job's.
async function imageFromUrl(url: string): Promise<ImageFile> {
  if (!allowedUrl(url)) throw new Error(`Not an https URL on an allowed image host: ${url}`);
  const result = await fetchImage(url, { pace: makePacer() });
  if (result.kind === "image") return result.image;
  throw new Error(
    result.kind === "rejected"
      ? `Image refused: ${result.reason}`
      : result.kind === "none"
        ? "No image at that URL"
        : "The image host did not answer"
  );
}

/**
 * Internal: set a song's cover from a URL on an allowed host (see
 * imageSources.ts). The image is copied into file storage, the old file is
 * deleted, and the weekly job leaves the cover alone from then on.
 */
export const setSongCoverFromUrl = internalAction({
  args: { slug: v.string(), url: v.string() },
  handler: async (ctx, { slug, url }): Promise<{ slug: string; width: number; height: number }> => {
    const image = await imageFromUrl(url);
    const storageId = await storeImage(ctx, image);
    const saved: boolean = await ctx.runMutation(internal.contentImages.saveSongCover, {
      slug,
      storageId,
      width: image.width,
      height: image.height,
      byHand: true,
    });
    if (!saved) throw new Error(`No published song with slug "${slug}"`);
    return { slug, width: image.width, height: image.height };
  },
});

/**
 * Internal: set an artist's photo from a URL on an allowed host, with the
 * credit shown under it. `pageUrl` is the photo's Wikimedia Commons file
 * page. The license is not checked here: whoever runs this vouches for it.
 */
export const setArtistPhotoFromUrl = internalAction({
  args: { slug: v.string(), url: v.string(), author: v.string(), license: v.string(), pageUrl: v.string() },
  handler: async (ctx, args): Promise<{ slug: string; width: number; height: number }> => {
    const credit = (field: string, value: string) => {
      const text = value.replace(/\s+/g, " ").trim();
      if (!text) throw new Error(`${field} is empty`);
      if (text.length > MAX_CREDIT) throw new Error(`${field} is longer than ${MAX_CREDIT} characters`);
      return text;
    };
    const author = credit("author", args.author);
    const license = credit("license", args.license);
    const pageUrl = commonsPageUrl(args.pageUrl);
    if (!pageUrl) throw new Error(`pageUrl is not an https page on commons.wikimedia.org: ${args.pageUrl}`);
    const image = await imageFromUrl(args.url);
    const storageId = await storeImage(ctx, image);
    const saved: boolean = await ctx.runMutation(internal.contentImages.saveArtistPhoto, {
      slug: args.slug,
      storageId,
      width: image.width,
      height: image.height,
      author,
      license,
      pageUrl,
      byHand: true,
    });
    if (!saved) throw new Error(`No published artist with slug "${args.slug}"`);
    return { slug: args.slug, width: image.width, height: image.height };
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
