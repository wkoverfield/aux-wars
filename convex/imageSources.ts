/**
 * Outbound requests for the images on song and artist pages.
 *
 *   Song cover    coverartarchive.org, keyed by a MusicBrainz release group.
 *                 It answers with a redirect to an archive.org host.
 *   Artist photo  musicbrainz.org (artist, url relations) -> www.wikidata.org
 *                 (claim P18, a file name) -> commons.wikimedia.org (thumb
 *                 URL, author, license) -> upload.wikimedia.org or
 *                 thumb.wikimedia.org (the file).
 *
 * Only the hosts in isAllowedHost are ever requested, over https, with the
 * MusicBrainz User-Agent. Every request, redirect hops and retries included,
 * waits on the caller's pacer, and follows the retry rule of musicBrainz.ts.
 * An image is kept only when its content type is image/*, it is at most
 * MAX_IMAGE_BYTES, and its bytes parse as a JPEG, PNG, GIF or WebP.
 */
import {
  MUSICBRAINZ_HOST,
  MUSICBRAINZ_USER_AGENT,
  REQUEST_TIMEOUT_MS,
  RETRY_STATUSES,
  RETRY_WAITS_MS,
  isMbid,
} from "./musicBrainz";

export const COVER_ART_HOST = "coverartarchive.org";
export const WIKIDATA_HOST = "www.wikidata.org";
export const COMMONS_HOST = "commons.wikimedia.org";
export const UPLOAD_HOST = "upload.wikimedia.org";
// The Commons API hands out thumbnail URLs on this host.
export const THUMB_HOST = "thumb.wikimedia.org";
const WIKIMEDIA_FILE_HOSTS = new Set([UPLOAD_HOST, THUMB_HOST]);
const FIXED_HOSTS = new Set([MUSICBRAINZ_HOST, COVER_ART_HOST, WIKIDATA_HOST, COMMONS_HOST, UPLOAD_HOST, THUMB_HOST]);

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
// A Wikidata entity document of a well known artist runs to a few megabytes.
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
export const COVER_WIDTH = 250;
export const PHOTO_WIDTH = 320;
export const MAX_CREDIT = 120;

const isArchiveHost = (host: string) => host === "archive.org" || host.endsWith(".archive.org");

/** True for a host this module may request. */
export const isAllowedHost = (host: string) => FIXED_HOSTS.has(host) || isArchiveHost(host);

/** The URL when it is https on an allowed host, without credentials or a port. Otherwise null. */
export function allowedUrl(raw: string): URL | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  return isAllowedHost(url.hostname) ? url : null;
}

// A redirect is followed to the host that was asked, and from the Cover Art
// Archive or an archive.org host to any archive.org host. Nowhere else.
function redirectAllowed(from: URL, to: URL | null): to is URL {
  if (to === null) return false;
  if (to.hostname === from.hostname) return true;
  return (from.hostname === COVER_ART_HOST || isArchiveHost(from.hostname)) && isArchiveHost(to.hostname);
}

/**
 * `pace` is awaited before every request: share one pacer between everything
 * a run requests. No request starts after `deadline` (a Date.now() value).
 */
export type RequestContext = { pace: () => Promise<void>; deadline?: number };

export type Miss =
  // The host has nothing for this key (404), or the data holds no image.
  | { kind: "none" }
  // There is an answer and it cannot be used: a redirect off the allowlist,
  // not an image, too large, a license that is not accepted.
  | { kind: "rejected"; reason: string }
  // No usable answer after every retry. Nothing is known; ask again later.
  | { kind: "unavailable" };

type Reply = { kind: "ok"; contentType: string; bytes: Uint8Array } | Miss;

/** Reads a body, stopping as soon as it is longer than `maxBytes`. Null when it is. */
async function readCapped(res: Response, maxBytes: number): Promise<Uint8Array | null> {
  if (Number(res.headers.get("content-length") ?? 0) > maxBytes) return null;
  const reader = res.body?.getReader();
  if (!reader) {
    const all = new Uint8Array(await res.arrayBuffer());
    return all.byteLength > maxBytes ? null : all;
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return all;
}

// One request to one URL. "retry" is an answer worth asking for again: 503,
// 429, or no answer at all. A redirect is returned, not followed.
async function requestOnce(
  url: URL,
  first: URL,
  accept: string,
  maxBytes: number
): Promise<Reply | "retry" | { kind: "redirect"; to: URL | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      headers: { "User-Agent": MUSICBRAINZ_USER_AGENT, Accept: accept },
      redirect: "manual",
      signal: controller.signal,
    });
    if (RETRY_STATUSES.has(res.status)) return "retry";
    if (REDIRECT_STATUSES.has(res.status)) {
      const location = res.headers.get("location");
      return { kind: "redirect", to: location ? allowedUrl(new URL(location, url).toString()) : null };
    }
    // A runtime that follows redirects itself reports where the answer came
    // from. That place is held to the same rule as a redirect followed here.
    if (res.url && res.url !== url.toString() && !redirectAllowed(first, allowedUrl(res.url))) {
      return { kind: "rejected", reason: "redirected off the allowed hosts" };
    }
    if (res.status >= 400 && res.status < 500) return { kind: "none" };
    if (!res.ok) return { kind: "unavailable" };
    const bytes = await readCapped(res, maxBytes);
    if (bytes === null) return { kind: "rejected", reason: `larger than ${maxBytes} bytes` };
    return { kind: "ok", contentType: (res.headers.get("content-type") ?? "").toLowerCase(), bytes };
  } catch {
    return "retry";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GETs an allowed URL: paced, retried after each of RETRY_WAITS_MS while the
 * host answers 503 or 429 or does not answer, and following at most
 * MAX_REDIRECTS redirects, each checked against the allowlist before it is
 * requested.
 */
async function request(raw: string, rc: RequestContext, accept: string, maxBytes: number): Promise<Reply> {
  const first = allowedUrl(raw);
  if (!first) return { kind: "rejected", reason: "not an allowed URL" };
  let url = first;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let reply: Exclude<Awaited<ReturnType<typeof requestOnce>>, "retry">;
    for (let attempt = 0; ; attempt++) {
      if (rc.deadline !== undefined && Date.now() > rc.deadline) return { kind: "unavailable" };
      await rc.pace();
      const answer = await requestOnce(url, first, accept, maxBytes);
      if (answer !== "retry") {
        reply = answer;
        break;
      }
      if (attempt >= RETRY_WAITS_MS.length) return { kind: "unavailable" };
      await new Promise((resolve) => setTimeout(resolve, RETRY_WAITS_MS[attempt]));
    }
    if (reply.kind !== "redirect") return reply;
    if (!redirectAllowed(first, reply.to)) return { kind: "rejected", reason: "redirected off the allowed hosts" };
    url = reply.to;
  }
  return { kind: "rejected", reason: "too many redirects" };
}

async function getJson(raw: string, rc: RequestContext): Promise<{ kind: "ok"; body: unknown } | Miss> {
  const reply = await request(raw, rc, "application/json", MAX_JSON_BYTES);
  if (reply.kind !== "ok") return reply;
  try {
    return { kind: "ok", body: JSON.parse(new TextDecoder().decode(reply.bytes)) };
  } catch {
    return { kind: "unavailable" };
  }
}

// --- Image bytes ---

export type ImageFile = { bytes: Uint8Array; contentType: string; width: number; height: number };

const ascii = (b: Uint8Array, at: number, text: string) =>
  b.length >= at + text.length && [...text].every((ch, i) => b[at + i] === ch.charCodeAt(0));
const u16be = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1];
const u16le = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const u24le = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);

function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  let at = 2;
  while (at + 9 < b.length) {
    if (b[at] !== 0xff) return null;
    const marker = b[at + 1];
    if (marker === 0xff) {
      at += 1; // fill byte
    } else if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      at += 2; // no length
    } else if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: u16be(b, at + 5), width: u16be(b, at + 7) }; // start of frame
    } else {
      at += 2 + u16be(b, at + 2);
    }
  }
  return null;
}

function webpSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 30) return null;
  if (ascii(b, 12, "VP8 ")) return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  if (ascii(b, 12, "VP8L")) {
    return {
      width: 1 + (b[21] | ((b[22] & 0x3f) << 8)),
      height: 1 + ((b[22] >> 6) | (b[23] << 2) | ((b[24] & 0x0f) << 10)),
    };
  }
  if (ascii(b, 12, "VP8X")) return { width: 1 + u24le(b, 24), height: 1 + u24le(b, 27) };
  return null;
}

/** Type and pixel size read from the first bytes of a JPEG, PNG, GIF or WebP. Null for anything else. */
export function imageSize(b: Uint8Array): { contentType: string; width: number; height: number } | null {
  let contentType = "";
  let size: { width: number; height: number } | null = null;
  if (b.length >= 24 && b[0] === 0x89 && ascii(b, 1, "PNG\r\n\x1a\n")) {
    contentType = "image/png";
    size = { width: ((b[16] << 24) | (b[17] << 16) | u16be(b, 18)) >>> 0, height: ((b[20] << 24) | (b[21] << 16) | u16be(b, 22)) >>> 0 };
  } else if (b.length >= 10 && (ascii(b, 0, "GIF87a") || ascii(b, 0, "GIF89a"))) {
    contentType = "image/gif";
    size = { width: u16le(b, 6), height: u16le(b, 8) };
  } else if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    contentType = "image/jpeg";
    size = jpegSize(b);
  } else if (ascii(b, 0, "RIFF") && ascii(b, 8, "WEBP")) {
    contentType = "image/webp";
    size = webpSize(b);
  }
  if (!size || size.width < 1 || size.height < 1 || size.width > 20_000 || size.height > 20_000) return null;
  return { contentType, ...size };
}

export type ImageResult = { kind: "image"; image: ImageFile } | Miss;

/** Fetches one image from an allowed URL and checks it is an image of at most MAX_IMAGE_BYTES. */
export async function fetchImage(raw: string, rc: RequestContext): Promise<ImageResult> {
  const reply = await request(raw, rc, "image/*", MAX_IMAGE_BYTES);
  if (reply.kind !== "ok") return reply;
  if (!reply.contentType.startsWith("image/")) return { kind: "rejected", reason: "not an image" };
  const size = imageSize(reply.bytes);
  if (!size) return { kind: "rejected", reason: "not a JPEG, PNG, GIF or WebP" };
  return { kind: "image", image: { bytes: reply.bytes, ...size } };
}

// --- Song cover ---

export const coverUrl = (releaseGroupId: string) =>
  `https://${COVER_ART_HOST}/release-group/${releaseGroupId}/front-${COVER_WIDTH}`;

/** The front cover of a release group from the Cover Art Archive. A 404 is "none". */
export async function fetchCover(releaseGroupId: string, rc: RequestContext): Promise<ImageResult> {
  if (!isMbid(releaseGroupId)) return { kind: "none" };
  return fetchImage(coverUrl(releaseGroupId), rc);
}

// --- Artist photo ---

export type Photo = { image: ImageFile; author: string; license: string; pageUrl: string };
export type PhotoResult = { kind: "photo"; photo: Photo } | Miss;

/**
 * True for the licenses a photo may be shown under: CC0, public domain, and
 * CC BY or CC BY-SA in any version or port ("CC BY-SA 3.0 de"). NC and ND
 * variants and everything else are refused.
 */
export function acceptedLicense(shortName: string): boolean {
  const name = shortName.trim().toLowerCase();
  return (
    name === "public domain" ||
    /^cc0( 1\.0)?$/.test(name) ||
    /^cc by(-sa)?( \d(\.\d)?)?( [a-z]{2,5})?$/.test(name)
  );
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** HTML reduced to one line of plain text, at most `max` characters. */
export function plainText(html: unknown, max = MAX_CREDIT): string {
  if (typeof html !== "string") return "";
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] !== "#") return ENTITIES[code.toLowerCase()] ?? whole;
      const point = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : " ";
    })
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? text.slice(0, max).trim() : text;
}

/** The URL when it is an https page on commons.wikimedia.org, otherwise null. */
export function commonsPageUrl(raw: unknown): string | null {
  const url = typeof raw === "string" ? allowedUrl(raw) : null;
  return url && url.hostname === COMMONS_HOST ? url.toString() : null;
}

const WIKIDATA_ITEM = /^https?:\/\/www\.wikidata\.org\/(?:wiki|entity)\/(Q[1-9]\d*)$/;

type Claim = { rank?: unknown; mainsnak?: { datavalue?: { value?: unknown } } };

// File name of a Wikidata item's image (P18): the preferred claim, or the
// first one that is not deprecated.
function imageFileName(entityDocument: unknown): string | null {
  const entities = (entityDocument as { entities?: Record<string, { claims?: { P18?: unknown } }> } | null)?.entities;
  const entity = entities && typeof entities === "object" ? Object.values(entities)[0] : null;
  const claims = Array.isArray(entity?.claims?.P18) ? (entity.claims.P18 as Claim[]) : [];
  const usable = claims.filter((c) => c?.rank !== "deprecated" && typeof c?.mainsnak?.datavalue?.value === "string");
  const claim = usable.find((c) => c.rank === "preferred") ?? usable[0];
  const name = (claim?.mainsnak?.datavalue?.value as string | undefined)?.trim();
  return name && name.length <= 240 && !/[\n\r|#<>[\]{}]/.test(name) ? name : null;
}

/**
 * The Commons photo of a MusicBrainz artist, with its credit. "none" when the
 * artist has no Wikidata link, the item has no image, or Commons does not
 * know the file. "rejected" when the license is not acceptedLicense.
 */
export async function fetchArtistPhoto(artistMbid: string, rc: RequestContext): Promise<PhotoResult> {
  if (!isMbid(artistMbid)) return { kind: "none" };

  const artist = await getJson(`https://${MUSICBRAINZ_HOST}/ws/2/artist/${artistMbid}?inc=url-rels&fmt=json`, rc);
  if (artist.kind !== "ok") return artist;
  const relations = (artist.body as { relations?: unknown } | null)?.relations;
  let item: string | null = null;
  for (const rel of Array.isArray(relations) ? (relations as { type?: unknown; url?: { resource?: unknown } }[]) : []) {
    const resource = rel?.type === "wikidata" ? rel.url?.resource : null;
    const m = typeof resource === "string" ? WIKIDATA_ITEM.exec(resource) : null;
    if (m) {
      item = m[1];
      break;
    }
  }
  if (!item) return { kind: "none" };

  const entity = await getJson(`https://${WIKIDATA_HOST}/wiki/Special:EntityData/${item}.json`, rc);
  if (entity.kind !== "ok") return entity;
  const fileName = imageFileName(entity.body);
  if (!fileName) return { kind: "none" };

  const api = new URL(`https://${COMMONS_HOST}/w/api.php`);
  api.searchParams.set("action", "query");
  api.searchParams.set("titles", `File:${fileName}`);
  api.searchParams.set("prop", "imageinfo");
  api.searchParams.set("iiprop", "url|extmetadata");
  api.searchParams.set("iiurlwidth", String(PHOTO_WIDTH));
  api.searchParams.set("format", "json");
  const file = await getJson(api.toString(), rc);
  if (file.kind !== "ok") return file;
  const pages = (file.body as { query?: { pages?: Record<string, { imageinfo?: unknown }> } } | null)?.query?.pages;
  const page = pages && typeof pages === "object" ? Object.values(pages)[0] : null;
  const info = (Array.isArray(page?.imageinfo) ? page.imageinfo[0] : null) as {
    thumburl?: unknown;
    descriptionurl?: unknown;
    extmetadata?: Record<string, { value?: unknown } | undefined>;
  } | null;
  if (!info) return { kind: "none" };

  const license = plainText(info.extmetadata?.LicenseShortName?.value, 40);
  if (!acceptedLicense(license)) return { kind: "rejected", reason: `license "${license}" is not accepted` };
  const pageUrl = commonsPageUrl(info.descriptionurl);
  const thumb = typeof info.thumburl === "string" ? allowedUrl(info.thumburl) : null;
  if (!pageUrl || !thumb || !WIKIMEDIA_FILE_HOSTS.has(thumb.hostname)) {
    return { kind: "rejected", reason: "file is not on Wikimedia Commons" };
  }

  const image = await fetchImage(thumb.toString(), rc);
  if (image.kind !== "image") return image;
  return {
    kind: "photo",
    photo: {
      image: image.image,
      author: plainText(info.extmetadata?.Artist?.value) || "Unknown author",
      license,
      pageUrl,
    },
  };
}
