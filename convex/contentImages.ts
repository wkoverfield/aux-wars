/**
 * Images of the published pages: a cover per live song and a photo per live
 * artist, fetched once (imageSources.ts) and kept in Convex file storage.
 *
 * fillImages is the image step of the weekly job (contentJob.ts). It works
 * through the live rows that have no image yet, new and old alike:
 *   - a song needs its MusicBrainz release group id, an artist their
 *     MusicBrainz id. A row without one gets it from one recording lookup.
 *   - a search that ends without an image (no id, a 404, an image that was
 *     refused) is remembered on the row, and the row is not searched again
 *     for IMAGE_RETRY_INTERVAL_MS.
 *   - a search that got no answer is not remembered; the next run repeats it.
 *   - a row whose image was set or removed by hand is never touched.
 * A run handles at most MAX_IMAGES_PER_RUN rows and stops at its deadline.
 * The rest is reported as `remaining`.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, type ActionCtx, type MutationCtx } from "./_generated/server";
import { hidesSongs } from "./contentLib";
import {
  fetchArtistPhoto,
  fetchCover,
  type ImageFile,
  type ImageResult,
  type PhotoResult,
  type RequestContext,
} from "./imageSources";
import { lookupRecording } from "./musicBrainz";

// A row searched without finding an image is searched again after this long.
export const IMAGE_RETRY_INTERVAL_MS = 4 * 7 * 24 * 60 * 60 * 1000;
export const MAX_IMAGES_PER_RUN = 60;
// This many searches in a row without an answer end the image step of a run.
const MAX_CONSECUTIVE_FAILURES = 3;
const PAGE = 500;

type PendingSong = { slug: string; songKey: string; artistSlug: string; releaseGroupId: string | null };
type PendingArtist = {
  slug: string;
  artistKey: string;
  mbid: string | null;
  // A live song of the artist, to look their MusicBrainz id up through.
  lookupSong: { slug: string; songKey: string } | null;
};

const due = (checkedAt: number | undefined, checkedBefore: number) =>
  checkedAt === undefined || checkedAt < checkedBefore;

/** One page of the live songs that have no cover and are due a search. */
export const pendingSongs = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), checkedBefore: v.number() },
  handler: async (ctx, { cursor, checkedBefore }): Promise<{ rows: PendingSong[]; cursor: string | null }> => {
    const page = await ctx.db
      .query("publishedSongs")
      .withIndex("by_status", (q) => q.eq("status", "live"))
      .paginate({ cursor, numItems: PAGE });
    const hidden = new Map<string, boolean>();
    const rows: PendingSong[] = [];
    for (const song of page.page) {
      if (song.coverStorageId || song.coverSetByHand || !due(song.coverCheckedAt, checkedBefore)) continue;
      let hides = hidden.get(song.artistSlug);
      if (hides === undefined) {
        const artist = await ctx.db
          .query("publishedArtists")
          .withIndex("by_slug", (q) => q.eq("slug", song.artistSlug))
          .unique();
        hides = artist !== null && hidesSongs(artist);
        hidden.set(song.artistSlug, hides);
      }
      if (hides) continue; // not public: its artist is held
      rows.push({
        slug: song.slug,
        songKey: song.songKey,
        artistSlug: song.artistSlug,
        releaseGroupId: song.releaseGroupId ?? null,
      });
    }
    return { rows, cursor: page.isDone ? null : page.continueCursor };
  },
});

/** One page of the live artists that have no photo and are due a search. */
export const pendingArtists = internalQuery({
  args: { cursor: v.union(v.string(), v.null()), checkedBefore: v.number() },
  handler: async (ctx, { cursor, checkedBefore }): Promise<{ rows: PendingArtist[]; cursor: string | null }> => {
    const page = await ctx.db
      .query("publishedArtists")
      .withIndex("by_status", (q) => q.eq("status", "live"))
      .paginate({ cursor, numItems: PAGE });
    const rows: PendingArtist[] = [];
    for (const artist of page.page) {
      if (artist.photoStorageId || artist.photoSetByHand || !due(artist.photoCheckedAt, checkedBefore)) continue;
      const song = artist.mbid
        ? null
        : await ctx.db
            .query("publishedSongs")
            .withIndex("by_artistSlug_and_status", (q) => q.eq("artistSlug", artist.slug).eq("status", "live"))
            .first();
      rows.push({
        slug: artist.slug,
        artistKey: artist.artistKey,
        mbid: artist.mbid ?? null,
        lookupSong: song ? { slug: song.slug, songKey: song.songKey } : null,
      });
    }
    return { rows, cursor: page.isDone ? null : page.continueCursor };
  },
});

const songBySlug = (ctx: MutationCtx, slug: string) =>
  ctx.db
    .query("publishedSongs")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .unique();
const artistBySlug = (ctx: MutationCtx, slug: string) =>
  ctx.db
    .query("publishedArtists")
    .withIndex("by_slug", (q) => q.eq("slug", slug))
    .unique();

/**
 * Stores the ids one recording lookup returned: the release group on the
 * song, the artist id on the song's artist. An id already stored is kept.
 */
export const storeIds = internalMutation({
  args: { slug: v.string(), releaseGroupId: v.optional(v.string()), artistMbid: v.optional(v.string()) },
  handler: async (ctx, { slug, releaseGroupId, artistMbid }) => {
    const song = await songBySlug(ctx, slug);
    if (!song) return;
    if (releaseGroupId && !song.releaseGroupId) await ctx.db.patch(song._id, { releaseGroupId });
    if (!artistMbid) return;
    const artist = await artistBySlug(ctx, song.artistSlug);
    if (artist && !artist.mbid) await ctx.db.patch(artist._id, { mbid: artistMbid });
  },
});

/** Records that a search for a song's cover ended without one. */
export const markCoverChecked = internalMutation({
  args: { slug: v.string(), at: v.number() },
  handler: async (ctx, { slug, at }) => {
    const song = await songBySlug(ctx, slug);
    if (song && !song.coverStorageId && !song.coverSetByHand) await ctx.db.patch(song._id, { coverCheckedAt: at });
  },
});

/** Records that a search for an artist's photo ended without one. */
export const markPhotoChecked = internalMutation({
  args: { slug: v.string(), at: v.number() },
  handler: async (ctx, { slug, at }) => {
    const artist = await artistBySlug(ctx, slug);
    if (artist && !artist.photoStorageId && !artist.photoSetByHand) {
      await ctx.db.patch(artist._id, { photoCheckedAt: at });
    }
  },
});

/**
 * Points a song at a stored cover. From the job (byHand false) it writes only
 * a row that has no cover and was never set by hand. By hand it replaces the
 * cover, deletes the old file and marks the row so the job leaves it alone.
 * Returns false, after deleting the new file, when nothing was written: the
 * job found the row taken, or no row has that slug.
 */
export const saveSongCover = internalMutation({
  args: { slug: v.string(), storageId: v.id("_storage"), width: v.number(), height: v.number(), byHand: v.boolean() },
  handler: async (ctx, { slug, storageId, width, height, byHand }): Promise<boolean> => {
    const song = await songBySlug(ctx, slug);
    if (!song || (!byHand && (song.coverStorageId || song.coverSetByHand))) {
      // Returned, not thrown: a throw would roll the delete back.
      await ctx.storage.delete(storageId);
      return false;
    }
    if (song.coverStorageId) await ctx.storage.delete(song.coverStorageId);
    await ctx.db.patch(song._id, {
      coverStorageId: storageId,
      coverWidth: width,
      coverHeight: height,
      coverCheckedAt: undefined,
      coverSetByHand: byHand ? true : song.coverSetByHand,
    });
    return true;
  },
});

/** Points an artist at a stored photo and its credit. Same rules as saveSongCover. */
export const saveArtistPhoto = internalMutation({
  args: {
    slug: v.string(),
    storageId: v.id("_storage"),
    width: v.number(),
    height: v.number(),
    author: v.string(),
    license: v.string(),
    pageUrl: v.string(),
    byHand: v.boolean(),
  },
  handler: async (ctx, { slug, storageId, width, height, author, license, pageUrl, byHand }): Promise<boolean> => {
    const artist = await artistBySlug(ctx, slug);
    if (!artist || (!byHand && (artist.photoStorageId || artist.photoSetByHand))) {
      await ctx.storage.delete(storageId);
      return false;
    }
    if (artist.photoStorageId) await ctx.storage.delete(artist.photoStorageId);
    await ctx.db.patch(artist._id, {
      photoStorageId: storageId,
      photoWidth: width,
      photoHeight: height,
      photoAuthor: author,
      photoLicense: license,
      photoPageUrl: pageUrl,
      photoCheckedAt: undefined,
      photoSetByHand: byHand ? true : artist.photoSetByHand,
    });
    return true;
  },
});

/** Puts an image's bytes in file storage. */
export async function storeImage(ctx: ActionCtx, image: ImageFile): Promise<Id<"_storage">> {
  return ctx.storage.store(new Blob([image.bytes as Uint8Array<ArrayBuffer>], { type: image.contentType }));
}

export type ImageSummary = {
  coversStored: number;
  photosStored: number;
  // Searches that ended without an image. Remembered on the row.
  notFound: number;
  // Searches that got no answer or threw. Repeated by the next run.
  failed: number;
  // Rows due a search that this run did not reach.
  remaining: number;
  // Set when the image step as a whole stopped on an error.
  error: string | null;
};

export const emptyImageSummary = (): ImageSummary => ({
  coversStored: 0,
  photosStored: 0,
  notFound: 0,
  failed: 0,
  remaining: 0,
  error: null,
});

/**
 * The image step of one weekly run. `picks` orders the work, most picked
 * first, by song key and by artist key. Songs and artists take turns, so
 * neither waits for the other to finish. Counts go into `summary` as they
 * happen, so they survive an error thrown part way.
 */
export async function fillImages(
  ctx: ActionCtx,
  rc: RequestContext & { deadline: number },
  picks: { song: (songKey: string) => number; artist: (artistKey: string) => number },
  summary: ImageSummary
): Promise<void> {
  const checkedBefore = Date.now() - IMAGE_RETRY_INTERVAL_MS;
  const songs: PendingSong[] = [];
  for (let cursor: string | null = null; ; ) {
    const page: { rows: PendingSong[]; cursor: string | null } = await ctx.runQuery(
      internal.contentImages.pendingSongs,
      { cursor, checkedBefore }
    );
    songs.push(...page.rows);
    if (page.cursor === null) break;
    cursor = page.cursor;
  }
  const artists: PendingArtist[] = [];
  for (let cursor: string | null = null; ; ) {
    const page: { rows: PendingArtist[]; cursor: string | null } = await ctx.runQuery(
      internal.contentImages.pendingArtists,
      { cursor, checkedBefore }
    );
    artists.push(...page.rows);
    if (page.cursor === null) break;
    cursor = page.cursor;
  }
  songs.sort((a, b) => picks.song(b.songKey) - picks.song(a.songKey) || (a.slug < b.slug ? -1 : 1));
  artists.sort((a, b) => picks.artist(b.artistKey) - picks.artist(a.artistKey) || (a.slug < b.slug ? -1 : 1));
  summary.remaining = songs.length + artists.length;

  // Artist ids found by this run's lookups, by artist slug.
  const artistIds = new Map<string, string>();
  // One recording lookup for a song: stores the ids it returns.
  const lookupIds = async (song: { slug: string; songKey: string }, artistSlug: string) => {
    const result = await lookupRecording(song.songKey, rc.pace);
    if (result.kind === "unavailable") return null;
    const match = result.kind === "match" ? result.match : null;
    if (match?.releaseGroupId || match?.artistMbid) {
      await ctx.runMutation(internal.contentImages.storeIds, {
        slug: song.slug,
        releaseGroupId: match.releaseGroupId,
        artistMbid: match.artistMbid,
      });
    }
    if (match?.artistMbid && !artistIds.has(artistSlug)) artistIds.set(artistSlug, match.artistMbid);
    return { releaseGroupId: match?.releaseGroupId ?? null, artistMbid: match?.artistMbid ?? null };
  };

  const cover = async (song: PendingSong): Promise<ImageResult> => {
    let releaseGroupId = song.releaseGroupId;
    if (!releaseGroupId) {
      const ids = await lookupIds(song, song.artistSlug);
      if (ids === null) return { kind: "unavailable" };
      releaseGroupId = ids.releaseGroupId;
    }
    return releaseGroupId ? fetchCover(releaseGroupId, rc) : { kind: "none" };
  };
  const photo = async (artist: PendingArtist): Promise<PhotoResult> => {
    let mbid = artist.mbid ?? artistIds.get(artist.slug) ?? null;
    if (!mbid && artist.lookupSong) {
      const ids = await lookupIds(artist.lookupSong, artist.slug);
      if (ids === null) return { kind: "unavailable" };
      mbid = ids.artistMbid;
    }
    return mbid ? fetchArtistPhoto(mbid, rc) : { kind: "none" };
  };

  let handled = 0;
  let failures = 0;
  for (let turn = 0; songs.length + artists.length > 0; turn++) {
    if (handled >= MAX_IMAGES_PER_RUN || failures >= MAX_CONSECUTIVE_FAILURES || Date.now() > rc.deadline) break;
    const song = (turn % 2 === 0 || artists.length === 0) && songs.length > 0 ? songs.shift()! : null;
    const artist = song ? null : artists.shift()!;
    handled++;
    summary.remaining--;
    let outcome: "stored" | "none" | "failed" = "failed";
    try {
      if (song) {
        const result = await cover(song);
        if (result.kind === "image") {
          const storageId = await storeImage(ctx, result.image);
          const saved: boolean = await ctx.runMutation(internal.contentImages.saveSongCover, {
            slug: song.slug,
            storageId,
            width: result.image.width,
            height: result.image.height,
            byHand: false,
          });
          if (saved) summary.coversStored++;
          outcome = "stored";
        } else if (result.kind !== "unavailable") {
          await ctx.runMutation(internal.contentImages.markCoverChecked, { slug: song.slug, at: Date.now() });
          outcome = "none";
        }
      } else if (artist) {
        const result = await photo(artist);
        if (result.kind === "photo") {
          const { image, author, license, pageUrl } = result.photo;
          const storageId = await storeImage(ctx, image);
          const saved: boolean = await ctx.runMutation(internal.contentImages.saveArtistPhoto, {
            slug: artist.slug,
            storageId,
            width: image.width,
            height: image.height,
            author,
            license,
            pageUrl,
            byHand: false,
          });
          if (saved) summary.photosStored++;
          outcome = "stored";
        } else if (result.kind !== "unavailable") {
          await ctx.runMutation(internal.contentImages.markPhotoChecked, { slug: artist.slug, at: Date.now() });
          outcome = "none";
        }
      }
    } catch {
      outcome = "failed";
    }
    if (outcome === "failed") {
      summary.failed++;
      failures++;
    } else {
      failures = 0;
      if (outcome === "none") summary.notFound++;
    }
  }
}
