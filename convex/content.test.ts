import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import presenceComponent from "@convex-dev/presence/test";
import { songKey } from "./songStats";
import { CURATED_PROMPTS } from "./game/promptPacks";
import { isBlocked } from "./contentBlocklist";
import {
  ARTIST_MIN_PICKS,
  MAX_SLUG,
  SONG_MIN_RATINGS,
  artistSlugBase,
  computeLists,
  decideSong,
  firstFreeSlug,
  isArtistCandidate,
  isWeekId,
  isSongCandidate,
  ratingSpread,
  slugPart,
  songSlugBase,
  weekIdFor,
  weekRange,
} from "./contentLib";
import { MAX_LOOKUPS_PER_RUN } from "./contentJob";
import { IMAGE_RETRY_INTERVAL_MS, MAX_IMAGES_PER_RUN } from "./contentImages";
import {
  MAX_CREDIT,
  MAX_IMAGE_BYTES,
  acceptedLicense,
  allowedUrl,
  coverUrl,
  imageSize,
  isAllowedHost,
  plainText,
} from "./imageSources";
import {
  MATCH_MIN_SCORE,
  MUSICBRAINZ_USER_AGENT,
  PUBLISH_MIN_SCORE,
  REQUEST_INTERVAL_MS,
  RETRY_WAITS_MS,
  lookupRecording,
  makePacer,
  pickRecording,
  recordingSearchUrl,
} from "./musicBrainz";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./**/*.d.ts"]);

function setup() {
  const t = convexTest(schema, modules);
  presenceComponent.register(t, "presence");
  return t;
}
type T = ReturnType<typeof setup>;

// Thursday 2026-11-19, in ISO week 2026-W47 (Monday the 16th to Sunday the 22nd).
const THURSDAY = Date.UTC(2026, 10, 19, 15, 0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(THURSDAY);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// --- MusicBrainz stand-in ---

type Recording = {
  id: string;
  score: number;
  title: string;
  "artist-credit": { name: string; joinphrase?: string; artist?: { id: string } }[];
  "first-release-date"?: string;
  releases?: { id: string; date?: string; "release-group"?: { id: string } }[];
};

function rec(title: string, artist: string, date?: string, score = 100): Recording {
  return {
    id: `mbid-${title}-${date ?? "undated"}`,
    score,
    title,
    "artist-credit": [{ name: artist }],
    "first-release-date": date,
  };
}

/**
 * A recording with a multi-artist credit, written as names and join phrases
 * in turn: credited("id", 85, "Starboy", ["The Weeknd", " feat. ", "Daft Punk"]).
 */
function credited(id: string, score: number, title: string, credit: string[], date?: string): Recording {
  const artists: Recording["artist-credit"] = [];
  for (let i = 0; i < credit.length; i += 2) artists.push({ name: credit[i], joinphrase: credit[i + 1] });
  return { id, score, title, "artist-credit": artists, "first-release-date": date };
}

// Search responses as musicbrainz.org returned them on 2026-11-19, cut down
// to the rows that decide the match. The featured artist is in the credit of
// the original recordings and absent from the song key.
const WEEKND = ["The Weeknd", " feat. ", "Daft Punk"];
const STARBOY: Recording[] = [
  credited("starboy-undated", 100, "Starboy", ["The Weeknd"]),
  credited("starboy-live-clean", 100, "Starboy", ["The Weeknd"], "2023-03-03"),
  credited("starboy-live-explicit", 100, "Starboy", ["The Weeknd"], "2023-03-03"),
  credited("starboy-atmos", 85, "Starboy", WEEKND, "2019-11-07"),
  credited("starboy-snl", 85, "Starboy", WEEKND, "2016-10-01"),
  credited("starboy-single", 85, "Starboy", ["The Weeknd", " ft. ", "Daft Punk"], "2016-09-22"),
  credited("starboy-video", 85, "Starboy", WEEKND, "2017-02"),
  credited("starboy-album", 85, "Starboy", ["The Weeknd", " featuring ", "Daft Punk"], "2016-11-04"),
  credited("starboy-medley", 81, "Crew Love / Starboy", ["The Weeknd"], "2022"),
  credited("starboy-kygo", 71, "Starboy (Kygo remix)", ["The Weeknd", " & ", "Daft Punk"], "2016-11-11"),
];
const TRAVIS = ["Travis Scott", " feat. ", "Playboi Carti"];
const FEIN: Recording[] = [
  credited("fein-griz", 100, "Fe!n (GRiZ flip)", ["Travis Scott"], "2025-06-17"),
  credited("fein-atmos", 95, "FE!N", TRAVIS, "2023-09-23"),
  credited("fein-video", 95, "FE!N", TRAVIS, "2024-04-01"),
  credited("fein-album", 95, "FE!N", TRAVIS, "2023-07-28"),
  credited("fein-clean", 95, "FE!N", TRAVIS, "2023-09-21"),
  credited("fein-v1", 86, "FE!N", [...TRAVIS, " & ", "Sheck Wes"], "2023-07-28"),
  credited("fein-bootleg", 82, "fe!n (saka bootleg)", ["travis scott", " ft. ", "playboi carti"], "2024-11-29"),
  credited("fein-dj-mix", 54, "All I Want for Christmas Is You / FE!N", ["Mariah Carey", " / ", ...TRAVIS], "2025-06-01"),
];
const ROCKSTAR: Recording[] = [
  credited("rockstar-undated", 100, "rockstar", ["Post Malone"]),
  credited("rockstar-remix", 89, "Rockstar (Echo3zDown Remix)", ["Post Malone"], "2018-07-10"),
  credited("rockstar-2018", 80, "Rockstar", ["Post Malone", " featuring ", "21 Savage"], "2018-03-23"),
  credited("rockstar-year-only", 80, "Rockstar", ["Post Malone", " feat. ", "21 Savage"], "2018"),
  credited("rockstar-single", 80, "rockstar", ["Post Malone", " feat. ", "21 Savage"], "2017-09-15"),
  credited("rockstar-duo", 80, "rockstar", ["Post Malone", " & ", "21 Savage"], "2017-10-13"),
];

type Call = { url: URL; at: number; userAgent: string | null; method: string };

type Answer = number | "network error";

/**
 * Replaces fetch. `catalog` maps a song key to the recordings a search
 * returns. `status` is what musicbrainz.org answers a search: one value for
 * every request, or a function of the request's number (0-based) and song
 * key. `other` answers every request that is not a recording search; without
 * it they get an empty 200.
 */
function stubFetch(
  catalog: Record<string, Recording[]> = {},
  status: Answer | ((n: number, songKey: string) => Answer) = 200,
  other?: (url: URL) => Response | Promise<Response>
) {
  const calls: Call[] = [];
  let searches = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push({
        url,
        at: Date.now(),
        userAgent: new Headers(init?.headers).get("user-agent"),
        method: init?.method ?? "GET",
      });
      if (url.host !== "musicbrainz.org" || url.pathname !== "/ws/2/recording") {
        return other ? other(url) : new Response("", { status: 200 });
      }
      const m = /^recording:\((.*)\) AND artist:\((.*)\)$/.exec(url.searchParams.get("query") ?? "");
      const key = m ? `${m[2]}|${m[1]}` : "";
      const answer = typeof status === "function" ? status(searches++, key) : status;
      if (answer === "network error") throw new TypeError("fetch failed");
      if (answer !== 200) return new Response(JSON.stringify({ error: "busy" }), { status: answer });
      const recordings = catalog[key] ?? [];
      return new Response(JSON.stringify({ count: recordings.length, recordings }), { status: 200 });
    })
  );
  return calls;
}

/** Awaits a promise that sleeps on timers, moving the fake clock forward. */
async function settle<T>(promise: Promise<T>): Promise<T> {
  let done = false;
  const tracked = promise.finally(() => {
    done = true;
  });
  tracked.catch(() => {});
  while (!done) await vi.advanceTimersByTimeAsync(REQUEST_INTERVAL_MS);
  return tracked;
}

/**
 * Runs the weekly job. A run only writes the week it happens in, so naming a
 * week first moves the clock to that week's Thursday.
 */
function runWeekly(t: T, args: { week?: string } = {}) {
  if (args.week && isWeekId(args.week) && weekIdFor(Date.now()) !== args.week) {
    vi.setSystemTime(Date.parse(`${weekRange(args.week).weekStart}T15:00:00Z`) + 3 * 24 * 60 * 60 * 1000);
  }
  return settle(t.action(internal.contentJob.runWeekly, args));
}

// --- songStats fixtures ---

const fives = (n: number) => [0, 0, 0, 0, n];

/**
 * Inserts one songStats row. The stored name, artist, cover and source are
 * marked so a test can prove they never reach the public read.
 */
async function stat(
  t: T,
  title: string,
  artist: string,
  o: { picks: number; wins?: number; hist: number[]; prompt?: string }
) {
  const key = songKey(title, artist)!;
  await t.run(async (ctx) => {
    await ctx.db.insert("songStats", {
      songKey: key,
      prompt: o.prompt,
      name: `${title} [yt-raw]`,
      artist: `${artist} [yt-raw]`,
      albumCover: "https://img.example/cover-leak.jpg",
      picks: o.picks,
      wins: o.wins ?? 0,
      ratingCount: o.hist.reduce((s, n) => s + n, 0),
      ratingSum: o.hist.reduce((s, n, i) => s + n * (i + 1), 0),
      ratingHist: o.hist,
      sources: ["yt:leak-source"],
      firstSeenAt: 1,
      lastSeenAt: 1,
    });
  });
  return key;
}

async function setPicks(t: T, title: string, artist: string, picks: number) {
  const key = songKey(title, artist)!;
  await t.run(async (ctx) => {
    const row = await ctx.db
      .query("songStats")
      .withIndex("by_song_prompt", (q) => q.eq("songKey", key).eq("prompt", undefined))
      .unique();
    await ctx.db.patch(row!._id, { picks });
  });
}

const CATALOG: Record<string, Recording[]> = {
  "outkast|hey ya": [rec("Hey Ya!", "OutKast", "2003-09-23")],
  "outkast|ms jackson": [rec("Ms. Jackson", "OutKast", "2000-10-03")],
  "earth wind and fire|september": [
    rec("September", "Earth, Wind & Fire", "1999"),
    rec("September", "Earth, Wind & Fire", "1978-11-18"),
  ],
  "rebecca black|friday": [rec("Friday", "Rebecca Black", "2011-03-14")],
};

/**
 * Four songs MusicBrainz knows, one it does not, and one short of the bar.
 * OutKast has 52 picks across two songs; no other artist reaches 50.
 */
async function seedBank(t: T) {
  await stat(t, "Hey Ya!", "OutKast", { picks: 40, wins: 20, hist: [0, 0, 5, 20, 35] });
  await stat(t, "Hey Ya!", "OutKast", { picks: 9, hist: fives(20), prompt: CURATED_PROMPTS[0] });
  await stat(t, "Hey Ya!", "OutKast", { picks: 14, hist: fives(30), prompt: CURATED_PROMPTS[1] });
  await stat(t, "Ms. Jackson", "OutKast", { picks: 12, wins: 3, hist: [0, 0, 0, 25, 25] });
  await stat(t, "Ms. Jackson", "OutKast", { picks: 4, hist: fives(8), prompt: CURATED_PROMPTS[1] });
  await stat(t, "September", "Earth, Wind & Fire", { picks: 30, wins: 15, hist: [0, 0, 0, 10, 60] });
  await stat(t, "Friday", "Rebecca Black", { picks: 20, wins: 2, hist: [30, 0, 0, 0, 30] });
  await stat(t, "Unknown Jam", "Nobody Band", { picks: 15, hist: fives(55) });
  await stat(t, "Almost", "Close Call", { picks: 14, hist: fives(SONG_MIN_RATINGS - 1) });
  await stat(t, "One Play", "Close Call", { picks: 1, hist: fives(3) });
}

const table = <N extends "publishedSongs" | "publishedArtists" | "chartWeeks" | "chartBaselines" | "publishedSongStats" | "publishedArtistStats">(
  t: T,
  name: N
) => t.run((ctx) => ctx.db.query(name).collect());

type Section = "songs" | "artists" | "charts";
async function readAll(t: T, section: Section) {
  const items: any[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await t.query(api.content.published, { section, cursor });
    items.push(...page.items);
    if (page.cursor === null) return items;
    cursor = page.cursor;
  }
}

// --- Pure rules ---

describe("candidate thresholds", () => {
  test("a song needs 50 ratings, an artist 50 picks", () => {
    expect(SONG_MIN_RATINGS).toBe(50);
    expect(ARTIST_MIN_PICKS).toBe(50);
    expect(isSongCandidate({ ratingCount: 49 })).toBe(false);
    expect(isSongCandidate({ ratingCount: 50 })).toBe(true);
    expect(isArtistCandidate({ picks: 49 })).toBe(false);
    expect(isArtistCandidate({ picks: 50 })).toBe(true);
  });

  test("the job publishes only songs at the bar and lifts only artists at the bar", async () => {
    const t = setup();
    stubFetch({
      "a band|at the bar": [rec("At The Bar", "A Band")],
      "a band|under the bar": [rec("Under The Bar", "A Band")],
      "b band|b song": [rec("B Song", "B Band")],
    });
    await stat(t, "At The Bar", "A Band", { picks: 30, hist: fives(50) });
    await stat(t, "Under The Bar", "A Band", { picks: 20, hist: fives(49) }); // A Band: 50 picks
    await stat(t, "B Song", "B Band", { picks: 49, hist: fives(80) }); // B Band: 49 picks

    await runWeekly(t);

    const songs = await table(t, "publishedSongs");
    expect(songs.map((s) => s.slug).sort()).toEqual(["at-the-bar-a-band", "b-song-b-band"]);
    const artists = await table(t, "publishedArtists");
    expect(artists.find((a) => a.slug === "a-band")).toMatchObject({ status: "live" });
    expect(artists.find((a) => a.slug === "b-band")).toMatchObject({ status: "held", heldReason: "below_bar" });
  });
});

describe("slugs", () => {
  test("are lower case ASCII words joined by hyphens", () => {
    expect(slugPart("Hey Ya!")).toBe("hey-ya");
    expect(slugPart("Señorita")).toBe("senorita");
    expect(slugPart("God's Plan")).toBe("gods-plan");
    expect(slugPart("Earth, Wind & Fire")).toBe("earth-wind-and-fire");
    expect(slugPart("Røyksopp / Mötley Crüe")).toBe("royksopp-motley-crue");
    expect(slugPart("  ---  ")).toBe("");
    expect(songSlugBase("Hey Ya!", "OutKast", "outkast|hey ya")).toBe("hey-ya-outkast");
    expect(artistSlugBase("AC/DC", "ac dc")).toBe("ac-dc");
  });

  test("fall back to a stable tag when a name has no Latin letters", () => {
    const song = songSlugBase("봄날", "방탄소년단", "방탄소년단|봄날");
    expect(song).toMatch(/^song-[a-z0-9]+$/);
    expect(songSlugBase("봄날", "방탄소년단", "방탄소년단|봄날")).toBe(song);
    expect(songSlugBase("피 땀 눈물", "방탄소년단", "방탄소년단|피 땀 눈물")).not.toBe(song);
    expect(songSlugBase("봄날", "BTS", "bts|봄날")).toMatch(/^song-[a-z0-9]+-bts$/);
    expect(artistSlugBase("방탄소년단", "방탄소년단")).toMatch(/^artist-[a-z0-9]+$/);
  });

  test("stay within the charset and length for hostile input", async () => {
    const inputs = ["a".repeat(5000), "ü ".repeat(400), "../../etc/passwd", "<script>", "%2F..%2F", "index", "🎵🎵", ""];
    for (const input of inputs) {
      const taken = new Set<string>();
      for (let i = 0; i < 3; i++) {
        const slug = await firstFreeSlug(songSlugBase(input, input, input), async (s) => taken.has(s));
        expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
        expect(slug.length).toBeLessThanOrEqual(MAX_SLUG);
        taken.add(slug);
      }
    }
    // "index" would clash with a directory index file.
    expect(await firstFreeSlug(artistSlugBase("Index", "index"), async () => false)).toBe("index-2");
  });

  test("a collision gets a numeric suffix and an existing slug never changes", async () => {
    const t = setup();
    // Song keys are NFKD, so the keys of non-Latin titles are built, not typed.
    const korean = songKey("봄날 Go", "X")!;
    const japanese = songKey("Go 夜", "X")!;
    stubFetch({
      "x|go": [rec("Go", "X")],
      [korean]: [rec("봄날 Go", "X")],
      [japanese]: [rec("Go 夜", "X")],
    });
    await stat(t, "Go", "X", { picks: 10, hist: fives(60) });
    await runWeekly(t, { week: "2026-W45" });
    expect((await table(t, "publishedSongs")).map((s) => s.slug)).toEqual(["go-x"]);

    await stat(t, "봄날 Go", "X", { picks: 90, hist: fives(90) });
    await stat(t, "Go 夜", "X", { picks: 80, hist: fives(70) });
    await setPicks(t, "Go", "X", 500);
    await runWeekly(t, { week: "2026-W46" });
    await runWeekly(t, { week: "2026-W46" });

    const bySongKey = Object.fromEntries((await table(t, "publishedSongs")).map((s) => [s.songKey, s.slug]));
    expect(bySongKey).toEqual({ "x|go": "go-x", [korean]: "go-x-2", [japanese]: "go-x-3" });
    expect((await table(t, "publishedSongs")).every((s) => s.status === "live")).toBe(true);
    // One artist row, shared by all three songs.
    expect((await table(t, "publishedArtists")).map((a) => a.slug)).toEqual(["x"]);
  });
});

describe("MusicBrainz matching", () => {
  const key = "outkast|hey ya";

  test("accepts an exact title and artist at score 90 or more", () => {
    expect(pickRecording(key, { recordings: [rec("Hey Ya!", "OutKast", "2003-09-23", 90)] })).toEqual({
      title: "Hey Ya!",
      artist: "OutKast",
      year: 2003,
      mbid: "mbid-Hey Ya!-2003-09-23",
    });
  });

  test("rejects a score below 90", () => {
    expect(pickRecording(key, { recordings: [rec("Hey Ya!", "OutKast", "2003", 89)] })).toBeNull();
  });

  test("rejects a title mismatch", () => {
    expect(pickRecording(key, { recordings: [rec("Hey Ya! (live)", "OutKast", "2003")] })).toBeNull();
    expect(pickRecording(key, { recordings: [rec("Hey", "OutKast", "2003")] })).toBeNull();
  });

  test("rejects an artist mismatch", () => {
    expect(pickRecording(key, { recordings: [rec("Hey Ya!", "OutKast Tribute Band", "2003")] })).toBeNull();
    expect(pickRecording(key, { recordings: [rec("Hey Ya!", "Obadiah Parker", "2006")] })).toBeNull();
  });

  test("joins a multi-artist credit and takes the earliest release", () => {
    const joint: Recording = {
      id: "joint",
      score: 100,
      title: "Señorita",
      "artist-credit": [{ name: "Shawn Mendes", joinphrase: " & " }, { name: "Camila Cabello" }],
      "first-release-date": "2019-06-21",
    };
    expect(pickRecording("shawn mendes and camila cabello|senorita", { recordings: [joint] })).toMatchObject({
      artist: "Shawn Mendes & Camila Cabello",
      year: 2019,
    });
    expect(pickRecording("earth wind and fire|september", { recordings: CATALOG["earth wind and fire|september"] })).toMatchObject({
      year: 1978,
    });
    expect(pickRecording(key, { recordings: [rec("Hey Ya!", "OutKast")] })).toMatchObject({ year: undefined });
  });

  test("a featured artist in the credit is the same song, published under the lead artist", () => {
    // "FE!N (feat. Playboi Carti)" and "FE!N" share a key; every original
    // recording is credited "Travis Scott feat. Playboi Carti".
    expect(songKey("FE!N (feat. Playboi Carti)", "Travis Scott")).toBe("travis scott|fe n");
    expect(pickRecording("travis scott|fe n", { recordings: FEIN })).toEqual({
      title: "FE!N",
      artist: "Travis Scott",
      year: 2023,
      mbid: "fein-album", // the earliest release; same day as fein-v1, lower mbid
    });
    // The featured artist's own key is not this song.
    expect(pickRecording("playboi carti|fe n", { recordings: FEIN })).toBeNull();
    expect(pickRecording("daft punk|starboy", { recordings: STARBOY })).toBeNull();
  });

  test("the year is the earliest release of the song, not of the best scored recording", () => {
    // The recordings credited to The Weeknd alone score 100 and are undated
    // or a 2023 live album; the 2016 originals credit Daft Punk and score 85.
    expect(pickRecording("the weeknd|starboy", { recordings: STARBOY })).toEqual({
      title: "Starboy",
      artist: "The Weeknd",
      year: 2016,
      mbid: "starboy-single",
    });
    expect(pickRecording("post malone|rockstar", { recordings: ROCKSTAR })).toEqual({
      title: "rockstar",
      artist: "Post Malone",
      year: 2017,
      mbid: "rockstar-single",
    });
    // Response order does not change the pick.
    expect(pickRecording("the weeknd|starboy", { recordings: [...STARBOY].reverse() })).toMatchObject({
      year: 2016,
      mbid: "starboy-single",
    });
  });

  test("no recording of the song at score 90 or more is no match", () => {
    const below = STARBOY.filter((r) => r.score < 90);
    expect(below.some((r) => r.title === "Starboy")).toBe(true);
    expect(pickRecording("the weeknd|starboy", { recordings: below })).toBeNull();
    // A remix at 100 does not vouch for the song.
    expect(
      pickRecording("travis scott|fe n", { recordings: FEIN.filter((r) => r.score < 90 || r.id === "fein-griz") })
    ).toBeNull();
  });

  test("the published recording scores 70 or more, whatever is released earlier", () => {
    expect(MATCH_MIN_SCORE).toBe(90);
    expect(PUBLISH_MIN_SCORE).toBe(70);
    const at = (id: string, score: number, date?: string) => credited(id, score, "Hey Ya!", ["OutKast"], date);
    // The 1999 entry is the earliest but scores 69; the 2001 one scores 70.
    const recordings = [at("album", 100, "2003-09-23"), at("demo", 69, "1999"), at("early", 70, "2001-05-01")];
    expect(pickRecording(key, { recordings })).toEqual({ title: "Hey Ya!", artist: "OutKast", year: 2001, mbid: "early" });
    // A low score still cannot make the match on its own.
    expect(pickRecording(key, { recordings: [at("demo", 69, "1999"), at("early", 89, "2001")] })).toBeNull();
    // The matching recording is published when nothing else clears the floor.
    expect(pickRecording(key, { recordings: [at("demo", 69, "1999"), at("album", 90, "2003")] })).toMatchObject({ mbid: "album" });
  });

  test("equal release dates go to the lowest mbid, in any response order", () => {
    const at = (id: string, score: number, date?: string) => credited(id, score, "Hey Ya!", ["OutKast"], date);
    const recordings = [at("c", 100, "2003-09-23"), at("a", 75, "2003-09-23"), at("b", 95, "2003-09-23"), at("0", 100, "2004")];
    const orders = [recordings, [...recordings].reverse(), [recordings[2], recordings[0], recordings[3], recordings[1]]];
    for (const order of orders) expect(pickRecording(key, { recordings: order })).toMatchObject({ mbid: "a", year: 2003 });
    // Undated recordings tie as well.
    expect(pickRecording(key, { recordings: [at("z", 100), at("y", 100)] })).toMatchObject({ mbid: "y" });
  });

  test("a date with a known month or day beats the bare year, and a bad date counts as none", () => {
    const at = (id: string, date?: string) => credited(id, 100, "Hey Ya!", ["OutKast"], date);
    expect(pickRecording(key, { recordings: [at("year", "2003"), at("day", "2003-09-23"), at("month", "2003-09")] })).toMatchObject({
      mbid: "day",
      year: 2003,
    });
    expect(pickRecording(key, { recordings: [at("bad", "0000"), at("worse", "soon"), at("good", "2004-01-01")] })).toMatchObject({
      mbid: "good",
      year: 2004,
    });
    expect(pickRecording(key, { recordings: [at("bad", "0000")] })).toMatchObject({ mbid: "bad", year: undefined });
  });

  test("ignores malformed responses", () => {
    for (const body of [null, {}, { recordings: "x" }, { recordings: [null, {}, { score: 100 }] }, { error: "busy" }]) {
      expect(pickRecording(key, body)).toBeNull();
    }
  });

  test("calls only musicbrainz.org with a descriptive User-Agent", async () => {
    const calls = stubFetch(CATALOG);
    expect(await lookupRecording(key)).toMatchObject({ kind: "match" });
    expect(await lookupRecording("nobody band|unknown jam")).toEqual({ kind: "none" });
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.url.origin).toBe("https://musicbrainz.org");
      expect(call.url.pathname).toBe("/ws/2/recording");
      expect(call.url.searchParams.get("fmt")).toBe("json");
      expect(call.userAgent).toBe(MUSICBRAINZ_USER_AGENT);
    }
    expect(MUSICBRAINZ_USER_AGENT).toContain("AuxWars");
    expect(MUSICBRAINZ_USER_AGENT).toContain("https://www.aux-wars.com");
    expect(new URL(recordingSearchUrl('a"b|c\\d')).searchParams.get("query")).toBe("recording:(c d) AND artist:(a b)");
  });

  test("a busy server is not a rejection", async () => {
    const calls = stubFetch(CATALOG, 503);
    expect(await settle(lookupRecording(key))).toEqual({ kind: "unavailable" });
    // The first request and three retries, each after a longer wait.
    expect(RETRY_WAITS_MS).toEqual([2000, 4000, 8000]);
    expect(calls).toHaveLength(4);
    expect(calls.slice(1).map((call, i) => call.at - calls[i].at)).toEqual(RETRY_WAITS_MS);
  });

  test.each([503, 429, "network error"] as const)("a %s answer is retried until the search succeeds", async (failure) => {
    const calls = stubFetch(CATALOG, (n) => (n < 3 ? failure : 200));
    expect(await settle(lookupRecording(key))).toMatchObject({ kind: "match", match: { title: "Hey Ya!" } });
    expect(calls).toHaveLength(4);
    for (let i = 1; i < calls.length; i++) expect(calls[i].at - calls[i - 1].at).toBeGreaterThanOrEqual(1000);
  });

  test("an answer that is neither busy nor rate limited is not retried", async () => {
    const calls = stubFetch(CATALOG, 500);
    expect(await settle(lookupRecording(key))).toEqual({ kind: "unavailable" });
    stubFetch(CATALOG, 400);
    expect(await settle(lookupRecording(key))).toEqual({ kind: "none" });
    expect(calls).toHaveLength(1);
  });

  test("retries share the pacer with the requests around them", async () => {
    // One pacer for two lookups: the second starts a full interval after the
    // first one's last retry, and no two requests are closer than a second.
    const calls = stubFetch(CATALOG, (n) => (n === 0 ? 503 : 200));
    const pace = makePacer();
    await settle(lookupRecording(key, pace));
    await settle(lookupRecording("outkast|ms jackson", pace));
    expect(calls).toHaveLength(3);
    for (let i = 1; i < calls.length; i++) expect(calls[i].at - calls[i - 1].at).toBeGreaterThanOrEqual(1000);
  });
});

describe("blocklist", () => {
  test("matches whole words only, after clean()", () => {
    expect(isBlocked("Sex on Fire")).toBe(true);
    expect(isBlocked("S.E.X.")).toBe(false);
    expect(isBlocked("SEX!")).toBe(true);
    expect(isBlocked("Pornô Star")).toBe(true);
    expect(isBlocked("jerk  off")).toBe(true);
    // A listed word inside a longer word is not a match.
    for (const ok of ["Sussex", "Scunthorpe", "Cocktail Hour", "Analog Dreams", "Raccoon City", "Cumulus", "Dickens", "Pakistani"]) {
      expect(isBlocked(ok)).toBe(false);
    }
    // Ordinary profanity is not listed.
    for (const ok of ["Fuck You", "Bad Bitch", "Shit Show", "Damn", "Ass Like That"]) {
      expect(isBlocked(ok)).toBe(false);
    }
    expect(isBlocked("")).toBe(false);
  });

  test("a blocked title or artist is held as filtered, matched or not", () => {
    const match = { title: "Sex on Fire", artist: "Kings of Leon", year: 2008, mbid: "m" };
    expect(decideSong("kings of leon|sex on fire", match)).toMatchObject({ status: "held", heldReason: "filtered", title: "Sex on Fire" });
    expect(decideSong("kings of leon|sex on fire", null)).toMatchObject({ status: "held", heldReason: "filtered" });
    expect(decideSong("porn band|nice song", { title: "Nice Song", artist: "Porn Band", mbid: "m" })).toMatchObject({ heldReason: "filtered" });
    expect(decideSong("outkast|hey ya", null)).toEqual({ title: "hey ya", artist: "outkast", status: "held", heldReason: "no_match" });
    expect(decideSong("outkast|hey ya", { title: "Hey Ya!", artist: "OutKast", year: 2003, mbid: "m" })).toEqual({
      title: "Hey Ya!",
      artist: "OutKast",
      year: 2003,
      mbid: "m",
      status: "live",
    });
  });

  test("the job holds a filtered song and its artist", async () => {
    const t = setup();
    stubFetch({ "porn band|nice song": [rec("Nice Song", "Porn Band")] });
    await stat(t, "Nice Song", "Porn Band", { picks: 60, hist: fives(60) });
    await runWeekly(t);
    expect(await table(t, "publishedSongs")).toMatchObject([{ status: "held", heldReason: "filtered" }]);
    expect(await table(t, "publishedArtists")).toMatchObject([{ status: "held", heldReason: "filtered" }]);
    expect(await readAll(t, "songs")).toEqual([]);
    expect(await readAll(t, "artists")).toEqual([]);
  });
});

describe("ISO weeks", () => {
  test("week ids and ranges", () => {
    expect(weekIdFor(THURSDAY)).toBe("2026-W47");
    expect(weekIdFor(Date.UTC(2026, 10, 16))).toBe("2026-W47"); // Monday 00:00
    expect(weekIdFor(Date.UTC(2026, 10, 15, 23, 59))).toBe("2026-W46"); // Sunday
    expect(weekIdFor(Date.UTC(2027, 0, 1))).toBe("2026-W53");
    expect(weekIdFor(Date.UTC(2024, 11, 30))).toBe("2025-W01");
    expect(weekIdFor(Date.UTC(2021, 0, 3))).toBe("2020-W53");
    expect(weekRange("2026-W47")).toEqual({ weekStart: "2026-11-16", weekEnd: "2026-11-22" });
    expect(weekRange("2025-W01")).toEqual({ weekStart: "2024-12-30", weekEnd: "2025-01-05" });
    expect(() => weekRange("2026-47")).toThrow();
  });

  test("the Monday run labels the week that just ended; a later run labels the week in progress", async () => {
    const t = setup();
    stubFetch();
    vi.setSystemTime(Date.UTC(2026, 10, 23, 10, 0)); // Monday, cron time
    expect((await runWeekly(t)).week).toBe("2026-W47");
    vi.setSystemTime(Date.UTC(2026, 10, 26, 18, 0)); // Thursday of W48
    expect((await runWeekly(t)).week).toBe("2026-W48");
    await expect(runWeekly(t, { week: "next week" })).rejects.toThrow();
  });

  test("a named week must be the one a run writes now", async () => {
    const t = setup();
    stubFetch();
    const run = (week: string) => settle(t.action(internal.contentJob.runWeekly, { week }));

    // Thursday of W47: only W47 can be written.
    for (const week of ["2026-W46", "2026-W48", "2025-W47"]) {
      await expect(run(week)).rejects.toThrow(`Cannot write ${week}`);
    }
    expect(await table(t, "chartWeeks")).toEqual([]);
    expect((await run("2026-W47")).week).toBe("2026-W47");
    expect((await run("2026-W47")).week).toBe("2026-W47");
    expect(await table(t, "chartWeeks")).toHaveLength(1);

    // Monday of W48, when the cron closes W47: both weeks can be written.
    vi.setSystemTime(Date.UTC(2026, 10, 23, 10, 0));
    await expect(run("2026-W46")).rejects.toThrow("only 2026-W47 or 2026-W48");
    expect((await run("2026-W47")).week).toBe("2026-W47");
    expect((await run("2026-W48")).week).toBe("2026-W48");
    await expect(run("2026-W49")).rejects.toThrow();
    expect((await table(t, "chartWeeks")).map((c) => c.week).sort()).toEqual(["2026-W47", "2026-W48"]);
  });
});

describe("chart lists", () => {
  test("rating spread is the standard deviation of the ratings", () => {
    expect(ratingSpread([0, 0, 0, 0, 10])).toBe(0);
    expect(ratingSpread([5, 0, 0, 0, 5])).toBe(2);
    expect(ratingSpread([0, 0, 0, 0, 0])).toBe(0);
    expect(ratingSpread([1, 1, 1, 1, 1])).toBeCloseTo(Math.SQRT2);
  });

  test("rated lists keep the 50 rating floor and list sizes are capped", () => {
    const song = (i: number, ratings: number) => ({
      slug: `s${String(i).padStart(2, "0")}`,
      songKey: `a|s${i}`,
      totals: { picks: 100 - i, wins: 0, ratingCount: ratings, ratingSum: ratings * 5, ratingHist: fives(ratings) },
    });
    const songs = [...Array.from({ length: 30 }, (_, i) => song(i, 60)), song(30, 49)];
    const artists = Array.from({ length: 30 }, (_, i) => ({ slug: `a${i}`, picks: 60 + i }));
    const lists = computeLists(songs, artists, null);
    expect(lists.mostPickedSongs).toHaveLength(25);
    expect(lists.mostPickedSongs[0]).toEqual({ slug: "s00", value: 100 });
    expect(lists.mostPickedArtists).toHaveLength(25);
    expect(lists.mostPickedArtists[0]).toEqual({ slug: "a29", value: 89 });
    expect(lists.highestRated).toHaveLength(25);
    expect(lists.mostDivisive).toHaveLength(10);
    expect(lists.movers).toBeNull();
    expect(computeLists([song(30, 49)], [], null).highestRated).toEqual([]);
    expect(computeLists([song(30, 49)], [], null).mostDivisive).toEqual([]);

    const prior = new Map(songs.map((s, i) => [s.songKey, s.totals.picks - (i % 12)]));
    const movers = computeLists(songs, [], prior).movers!;
    expect(movers).toHaveLength(10);
    expect(movers[0].value).toBe(11);
    expect(movers.every((m) => m.value > 0)).toBe(true);
  });
});

// --- Weekly job and public read ---

describe("weekly job", () => {
  test("publishes candidates, holds what MusicBrainz does not know, and stores the chart", async () => {
    const t = setup();
    const calls = stubFetch(CATALOG);
    await seedBank(t);

    const summary = await runWeekly(t, { week: "2026-W46" });
    expect(summary).toMatchObject({ week: "2026-W46", songsScanned: 7, candidates: 5, carriedOver: 0 });
    expect(summary.artistsLifted).toEqual(["outkast"]);

    // One request per candidate, at least a second apart.
    expect(calls).toHaveLength(5);
    for (let i = 1; i < calls.length; i++) expect(calls[i].at - calls[i - 1].at).toBeGreaterThanOrEqual(1000);

    const songs = await table(t, "publishedSongs");
    expect(Object.fromEntries(songs.map((s) => [s.slug, s.status]))).toEqual({
      "hey-ya-outkast": "live",
      "ms-jackson-outkast": "live",
      "september-earth-wind-and-fire": "live",
      "friday-rebecca-black": "live",
      "unknown-jam-nobody-band": "held",
    });
    expect(songs.find((s) => s.slug === "hey-ya-outkast")).toMatchObject({
      songKey: "outkast|hey ya",
      title: "Hey Ya!",
      artist: "OutKast",
      artistSlug: "outkast",
      year: 2003,
      mbid: "mbid-Hey Ya!-2003-09-23",
    });
    expect(songs.find((s) => s.status === "held")).toMatchObject({ heldReason: "no_match", artistSlug: "nobody-band" });

    const artists = await table(t, "publishedArtists");
    expect(Object.fromEntries(artists.map((a) => [a.slug, a.status]))).toEqual({
      outkast: "live",
      "earth-wind-and-fire": "held",
      "rebecca-black": "held",
      "nobody-band": "held",
    });
    expect(artists.find((a) => a.slug === "earth-wind-and-fire")).toMatchObject({ name: "Earth, Wind & Fire", heldReason: "below_bar" });

    const [chart] = await table(t, "chartWeeks");
    expect(chart).toMatchObject({ week: "2026-W46", noteStatus: "none" });
    expect(chart.lists.mostPickedSongs).toEqual([
      { slug: "hey-ya-outkast", value: 40 },
      { slug: "september-earth-wind-and-fire", value: 30 },
      { slug: "friday-rebecca-black", value: 20 },
      { slug: "ms-jackson-outkast", value: 12 },
    ]);
    expect(chart.lists.mostPickedArtists).toEqual([{ slug: "outkast", value: 52 }]);
    expect(chart.lists.highestRated.map((r) => r.slug)).toEqual([
      "september-earth-wind-and-fire",
      "hey-ya-outkast",
      "ms-jackson-outkast",
      "friday-rebecca-black",
    ]);
    expect(chart.lists.highestRated[0].value).toBe(4.86);
    expect(chart.lists.mostDivisive[0]).toEqual({ slug: "friday-rebecca-black", value: 2 });
    expect(chart.lists.movers).toBeNull();

    // Baseline: every song with 5 or more picks, nothing else.
    const baselines = await table(t, "chartBaselines");
    expect(baselines).toHaveLength(1);
    expect(baselines[0].songs.map((s) => s.songKey)).not.toContain("close call|one play");
    expect(baselines[0].songs).toContainEqual({ songKey: "close call|almost", picks: 14, ratingCount: 49 });
    expect(baselines[0].songs).toHaveLength(6);
  });

  test("is idempotent for a repeated week and keeps the note", async () => {
    const t = setup();
    const calls = stubFetch(CATALOG);
    await seedBank(t);
    await runWeekly(t, { week: "2026-W46" });
    await t.mutation(internal.content.setChartNote, { week: "2026-W46", note: "A draft." });

    const snapshot = async () => ({
      songs: (await table(t, "publishedSongs")).map(({ _id, slug, status, publishedAt }) => ({ _id, slug, status, publishedAt })),
      artists: (await table(t, "publishedArtists")).map(({ _id, slug, status, name }) => ({ _id, slug, status, name })),
      charts: (await table(t, "chartWeeks")).map(({ _id, week, lists, note, noteStatus }) => ({ _id, week, lists, note, noteStatus })),
      baselines: (await table(t, "chartBaselines")).map(({ _id, week, chunk, songs }) => ({ _id, week, chunk, songs })),
      songStats: (await table(t, "publishedSongStats")).map(({ _id, slug, picks, rank }) => ({ _id, slug, picks, rank })),
      artistStats: (await table(t, "publishedArtistStats")).map(({ _id, slug, picks }) => ({ _id, slug, picks })),
    });
    const before = await snapshot();
    const lookups = calls.length;

    const again = await runWeekly(t, { week: "2026-W46" });
    expect(again).toMatchObject({ candidates: 0, published: [], carriedOver: 0, artistsLifted: [] });
    // A held song already has its row, so nothing is looked up twice.
    expect(calls).toHaveLength(lookups);
    expect(await snapshot()).toEqual(before);
    expect(before.charts).toHaveLength(1);
    expect(before.charts[0]).toMatchObject({ note: "A draft.", noteStatus: "draft" });
  });

  test("movers appear only once an earlier week has a baseline", async () => {
    const t = setup();
    stubFetch(CATALOG);
    await seedBank(t);

    expect((await runWeekly(t, { week: "2026-W46" })).lists.movers).toBeNull();
    // A second run of the same week still has no earlier week to compare with.
    expect((await runWeekly(t, { week: "2026-W46" })).lists.movers).toBeNull();

    await setPicks(t, "Hey Ya!", "OutKast", 45);
    await setPicks(t, "Ms. Jackson", "OutKast", 20);
    await setPicks(t, "Unknown Jam", "Nobody Band", 99); // held, never a mover
    await runWeekly(t, { week: "2026-W47" });
    await runWeekly(t, { week: "2026-W47" }); // compared with W46 again, not with itself

    const charts = await table(t, "chartWeeks");
    expect(charts.map((c) => c.week).sort()).toEqual(["2026-W46", "2026-W47"]);
    expect(charts.find((c) => c.week === "2026-W47")!.lists.movers).toEqual([
      { slug: "ms-jackson-outkast", value: 8 },
      { slug: "hey-ya-outkast", value: 5 },
    ]);
    expect(charts.find((c) => c.week === "2026-W46")!.lists.movers).toBeNull();
    expect(await table(t, "chartBaselines")).toHaveLength(2);
  });

  test("a busy MusicBrainz publishes nothing and leaves candidates for a later run", async () => {
    const t = setup();
    stubFetch(CATALOG, 503);
    await seedBank(t);
    const first = await runWeekly(t, { week: "2026-W46" });
    expect(first).toMatchObject({ candidates: 5, published: [], carriedOver: 5, nextPassScheduled: false });
    expect(first.unresolved).toHaveLength(5);
    expect(await table(t, "publishedSongs")).toEqual([]);
    expect(await table(t, "chartWeeks")).toHaveLength(1);

    stubFetch(CATALOG);
    const second = await runWeekly(t, { week: "2026-W46" });
    expect(second.published).toHaveLength(5);
    expect(second.unresolved).toEqual([]);
    expect(await table(t, "chartWeeks")).toHaveLength(1);
  });

  test("a lookup that fails is retried, and one that keeps failing is reported and left for the next run", async () => {
    const t = setup();
    await seedBank(t);
    // Ms. Jackson never gets an answer; September is busy twice, then answers.
    const busy = { "earth wind and fire|september": 2 };
    const calls = stubFetch(CATALOG, (_n, songKey) => {
      if (songKey === "outkast|ms jackson") return 503;
      if (songKey in busy && busy[songKey as keyof typeof busy]-- > 0) return 429;
      return 200;
    });

    const first = await runWeekly(t, { week: "2026-W46" });
    expect(first).toMatchObject({ candidates: 5, carriedOver: 1, unresolved: ["outkast|ms jackson"] });
    expect(first.published.map((p) => p.slug).sort()).toEqual([
      "friday-rebecca-black",
      "hey-ya-outkast",
      "september-earth-wind-and-fire",
      "unknown-jam-nobody-band",
    ]);
    const requestsFor = (songKey: string) =>
      calls.filter((c) => c.url.searchParams.get("query")!.includes(`(${songKey.split("|")[1]})`)).length;
    expect(requestsFor("earth wind and fire|september")).toBe(3);
    expect(requestsFor("outkast|ms jackson")).toBe(1 + RETRY_WAITS_MS.length);
    // Retries included, no two requests are closer than a second.
    for (let i = 1; i < calls.length; i++) expect(calls[i].at - calls[i - 1].at).toBeGreaterThanOrEqual(1000);
    // No row at all: the song is neither published nor held.
    expect((await table(t, "publishedSongs")).map((s) => s.songKey)).not.toContain("outkast|ms jackson");

    // The next run looks only that song up again.
    const before = calls.length;
    stubFetch(CATALOG);
    const second = await runWeekly(t, { week: "2026-W46" });
    expect(second).toMatchObject({ candidates: 1, carriedOver: 0, unresolved: [] });
    expect(second.published).toEqual([{ slug: "ms-jackson-outkast", status: "live", heldReason: null }]);
    expect(calls).toHaveLength(before);
  });

  test("the last pass schedules the site rebuild, with or without a chart note", async () => {
    const t = setup();
    vi.stubEnv("VERCEL_DEPLOY_HOOK_URL", "https://hooks.example/deploy/abc");
    const calls = stubFetch(CATALOG);
    await seedBank(t);
    const hookCalls = () => calls.filter((c) => c.url.host === "hooks.example");

    const summary = await runWeekly(t, { week: "2026-W46" });
    expect(summary).toMatchObject({ nextPassScheduled: false, deployScheduled: true });
    await settle(t.finishAllScheduledFunctions(vi.runAllTimers));
    expect(hookCalls().map((c) => [c.url.href, c.method])).toEqual([["https://hooks.example/deploy/abc", "POST"]]);

    // The note stays private until it is approved; the rebuild does not publish it.
    await t.mutation(internal.content.setChartNote, { week: "2026-W46", note: "Still a draft." });
    await runWeekly(t, { week: "2026-W46" });
    await settle(t.finishAllScheduledFunctions(vi.runAllTimers));
    expect(hookCalls()).toHaveLength(2);
    expect((await readAll(t, "charts"))[0]).toMatchObject({ note: null, approvedAt: null });
    expect((await table(t, "chartWeeks"))[0]).toMatchObject({ note: "Still a draft.", noteStatus: "draft" });
  });

  test("without a deploy hook the last pass requests nothing", async () => {
    const t = setup();
    vi.stubEnv("VERCEL_DEPLOY_HOOK_URL", "");
    const calls = stubFetch(CATALOG);
    await seedBank(t);
    expect(await runWeekly(t, { week: "2026-W46" })).toMatchObject({ deployScheduled: true });
    await settle(t.finishAllScheduledFunctions(vi.runAllTimers));
    expect(calls.filter((c) => c.url.host !== "musicbrainz.org")).toEqual([]);
  });

  test("lookups are capped per run and a follow-up pass finishes the rest", async () => {
    const t = setup();
    const calls = stubFetch({});
    const total = MAX_LOOKUPS_PER_RUN + 5;
    await t.run(async (ctx) => {
      for (let i = 0; i < total; i++) {
        await ctx.db.insert("songStats", {
          songKey: `band ${i}|song ${i}`,
          name: "n",
          artist: "a",
          albumCover: "",
          picks: 10,
          wins: 0,
          ratingCount: 60,
          ratingSum: 300,
          ratingHist: fives(60),
          sources: [],
          firstSeenAt: 1,
          lastSeenAt: 1,
        });
      }
    });

    const first = await runWeekly(t, { week: "2026-W46" });
    expect(first).toMatchObject({ candidates: total, carriedOver: 5, unresolved: [], nextPassScheduled: true, deployScheduled: false });
    expect(first.published).toHaveLength(MAX_LOOKUPS_PER_RUN);
    expect(calls).toHaveLength(MAX_LOOKUPS_PER_RUN);
    // Paced the whole way: the run took at least a second per lookup.
    expect(calls[calls.length - 1].at - calls[0].at).toBeGreaterThanOrEqual((MAX_LOOKUPS_PER_RUN - 1) * 1000);

    await settle(t.finishAllScheduledFunctions(vi.runAllTimers));
    expect(await table(t, "publishedSongs")).toHaveLength(total);
    expect(calls).toHaveLength(total);
    expect(await table(t, "chartWeeks")).toHaveLength(1);
  });

  test("a song whose recordings credit a featured artist gets a page, the right year and its chart rows", async () => {
    const t = setup();
    stubFetch({ "travis scott|fe n": FEIN, "the weeknd|starboy": STARBOY });
    await stat(t, "FE!N (feat. Playboi Carti)", "Travis Scott", { picks: 117, wins: 40, hist: [5, 10, 40, 100, 200] });
    await stat(t, "Starboy", "The Weeknd", { picks: 30, hist: fives(60) });
    await runWeekly(t, { week: "2026-W46" });

    const songs = await table(t, "publishedSongs");
    expect(songs.find((s) => s.songKey === "travis scott|fe n")).toMatchObject({
      slug: "fe-n-travis-scott",
      title: "FE!N",
      artist: "Travis Scott",
      artistSlug: "travis-scott",
      year: 2023,
      mbid: "fein-album",
      status: "live",
    });
    expect(songs.find((s) => s.songKey === "the weeknd|starboy")).toMatchObject({
      slug: "starboy-the-weeknd",
      artist: "The Weeknd",
      year: 2016,
      status: "live",
    });
    // The artist row is named after the lead artist, never the whole credit.
    expect((await table(t, "publishedArtists")).map((a) => [a.slug, a.name, a.status]).sort()).toEqual([
      ["the-weeknd", "The Weeknd", "held"],
      ["travis-scott", "Travis Scott", "live"],
    ]);

    expect((await readAll(t, "songs")).find((s) => s.slug === "fe-n-travis-scott")).toMatchObject({
      title: "FE!N",
      artist: "Travis Scott",
      year: 2023,
      picks: 117,
      rank: 1,
    });
    const [chart] = await readAll(t, "charts");
    expect(chart.lists.mostPickedSongs[0]).toMatchObject({ rank: 1, slug: "fe-n-travis-scott", value: 117 });
    expect(chart.lists.mostPickedArtists).toEqual([{ rank: 1, slug: "travis-scott", name: "Travis Scott", value: 117 }]);
  });

  test("an artist first seen through an unmatched song takes its name from a later match", async () => {
    const t = setup();
    stubFetch({});
    await stat(t, "Hey Ya!", "OutKast", { picks: 40, hist: fives(60) });
    await runWeekly(t, { week: "2026-W45" });
    expect(await table(t, "publishedArtists")).toMatchObject([{ slug: "outkast", name: "outkast", status: "held" }]);

    stubFetch(CATALOG);
    await stat(t, "Ms. Jackson", "OutKast", { picks: 12, hist: fives(50) });
    await runWeekly(t, { week: "2026-W46" });
    expect(await table(t, "publishedArtists")).toMatchObject([{ slug: "outkast", name: "OutKast", status: "live" }]);
    // The unmatched song keeps its row and stays held.
    expect((await table(t, "publishedSongs")).find((s) => s.songKey === "outkast|hey ya")).toMatchObject({
      status: "held",
      heldReason: "no_match",
    });
  });

  test("the dev seed yields live songs, live artists, held songs, prompts and movers", async () => {
    const t = setup();
    const known = (title: string, artist: string) => ({ [songKey(title, artist)!]: [rec(title, artist, "2010")] });
    stubFetch({
      ...known("Blinding Lights", "The Weeknd"),
      ...known("Starboy", "The Weeknd"),
      ...known("Hey Ya!", "OutKast"),
      ...known("Ms. Jackson", "OutKast"),
      ...known("September", "Earth, Wind & Fire"),
      ...known("Levitating", "Dua Lipa"),
      ...known("Friday", "Rebecca Black"),
      ...known("Señorita", "Shawn Mendes & Camila Cabello"),
      ...known("Sex on Fire", "Kings of Leon"),
    });

    vi.stubEnv("ALLOW_CONTENT_SEED", "1");
    const seeded = await t.mutation(internal.contentSeed.seedDevSongStats, {});
    expect(seeded.inserted).toBeGreaterThan(14);
    expect((await runWeekly(t, { week: "2026-W46" })).lists.movers).toBeNull();

    expect(await t.mutation(internal.contentSeed.seedDevSongStats, {})).toMatchObject({ inserted: 0, skipped: 0 });
    const summary = await runWeekly(t, { week: "2026-W47" });
    expect(summary.lists.movers).toBeGreaterThan(3);

    const songs = await readAll(t, "songs");
    expect(songs.length).toBe(8);
    expect(songs.find((s) => s.slug === "blinding-lights-the-weeknd").topPrompts.length).toBe(3);
    expect((await readAll(t, "artists")).map((a) => a.slug).sort()).toEqual(["outkast", "the-weeknd"]);
    const held = (await table(t, "publishedSongs")).filter((s) => s.status === "held");
    expect(held.map((s) => s.heldReason).sort()).toEqual(["filtered", "no_match"]);
    const [latest] = await readAll(t, "charts");
    expect(latest.lists.movers[0]).toMatchObject({ slug: "levitating-dua-lipa", value: 12 });
  });

  test("the dev seed never overwrites a row it did not create", async () => {
    const t = setup();
    await stat(t, "Blinding Lights", "The Weeknd", { picks: 3, hist: fives(9) });
    vi.stubEnv("ALLOW_CONTENT_SEED", "1");
    const seeded = await t.mutation(internal.contentSeed.seedDevSongStats, {});
    expect(seeded.skipped).toBe(1);
    const row = await t.run((ctx) =>
      ctx.db
        .query("songStats")
        .withIndex("by_song_prompt", (q) => q.eq("songKey", "the weeknd|blinding lights").eq("prompt", undefined))
        .unique()
    );
    expect(row).toMatchObject({ picks: 3, sources: ["yt:leak-source"] });
  });
});

describe("dev seed guard", () => {
  test.each([undefined, "", "0", "true"])("refuses to run when ALLOW_CONTENT_SEED is %j", async (value) => {
    const t = setup();
    if (value !== undefined) vi.stubEnv("ALLOW_CONTENT_SEED", value);
    await expect(t.mutation(internal.contentSeed.seedDevSongStats, {})).rejects.toThrow("ALLOW_CONTENT_SEED");
    expect(await t.run((ctx) => ctx.db.query("songStats").collect())).toEqual([]);
  });
});

/** Every key anywhere inside a value. */
function keysOf(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keysOf(v, into));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      into.add(k);
      keysOf(v, into);
    }
  }
  return into;
}

describe("content:published", () => {
  async function publishedBank() {
    const t = setup();
    stubFetch(CATALOG);
    await seedBank(t);
    await runWeekly(t, { week: "2026-W46" });
    return t;
  }

  test("songs: live rows with stats, rank and prompts", async () => {
    const t = await publishedBank();
    const songs = await readAll(t, "songs");
    expect(songs.map((s) => s.slug).sort()).toEqual([
      "friday-rebecca-black",
      "hey-ya-outkast",
      "ms-jackson-outkast",
      "september-earth-wind-and-fire",
    ]);
    expect(songs.find((s) => s.slug === "hey-ya-outkast")).toEqual({
      slug: "hey-ya-outkast",
      title: "Hey Ya!",
      artist: "OutKast",
      artistSlug: "outkast",
      year: 2003,
      picks: 40,
      wins: 20,
      ratingCount: 60,
      average: 4.5,
      ratingHist: [0, 0, 5, 20, 35],
      rank: 1,
      topPrompts: [
        { prompt: CURATED_PROMPTS[1], picks: 14 },
        { prompt: CURATED_PROMPTS[0], picks: 9 },
      ],
      image: null,
    });
    // Rank counts public songs only: 40, 30, 20, then this one at 12. The
    // held song at 15 and the unpublished one at 14 take no place.
    expect(songs.find((s) => s.slug === "ms-jackson-outkast")).toMatchObject({ rank: 4, topPrompts: [{ prompt: CURATED_PROMPTS[1], picks: 4 }] });
    // artistSlug is present even though that artist has no page.
    expect(songs.find((s) => s.slug === "september-earth-wind-and-fire")).toMatchObject({ artistSlug: "earth-wind-and-fire", year: 1978 });
  });

  test("a song's rank is its row on the most picked chart, ties included", async () => {
    const t = setup();
    const names = ["Alpha", "Bravo", "Charlie", "Delta"];
    stubFetch(Object.fromEntries(names.map((n) => [songKey(n, `${n} Band`)!, [rec(n, `${n} Band`, "2001")]])));
    await stat(t, "Alpha", "Alpha Band", { picks: 20, hist: fives(50) });
    await stat(t, "Bravo", "Bravo Band", { picks: 20, hist: fives(70) }); // same picks, more ratings
    await stat(t, "Charlie", "Charlie Band", { picks: 20, hist: fives(50) }); // same as Alpha: slug decides
    await stat(t, "Delta", "Delta Band", { picks: 5, hist: fives(50) });
    await stat(t, "Unmatched", "Nobody", { picks: 25, hist: fives(50) }); // held, takes no place
    await stat(t, "Unrated", "Nobody", { picks: 99, hist: fives(1) }); // never published
    await runWeekly(t);

    const [chart] = await readAll(t, "charts");
    const rows = chart.lists.mostPickedSongs.map((r: any) => [r.slug, r.rank]);
    expect(rows).toEqual([
      ["bravo-bravo-band", 1],
      ["alpha-alpha-band", 2],
      ["charlie-charlie-band", 3],
      ["delta-delta-band", 4],
    ]);
    expect((await readAll(t, "songs")).map((s) => [s.slug, s.rank]).sort((a, b) => a[1] - b[1])).toEqual(rows);
    // A held song stores the place it would take if it were public.
    const held = (await table(t, "publishedSongStats")).find((s) => s.slug === "unmatched-nobody");
    expect(held).toMatchObject({ rank: 1 });
  });

  test("artists: only live artists, with their live songs by picks", async () => {
    const t = await publishedBank();
    expect(await readAll(t, "artists")).toEqual([
      {
        slug: "outkast",
        name: "OutKast",
        picks: 52,
        ratingCount: 110,
        average: 4.5,
        image: null,
        songs: [
          { slug: "hey-ya-outkast", title: "Hey Ya!", picks: 40, ratingCount: 60, average: 4.5 },
          { slug: "ms-jackson-outkast", title: "Ms. Jackson", picks: 12, ratingCount: 50, average: 4.5 },
        ],
        topPrompts: [
          { prompt: CURATED_PROMPTS[1], picks: 18 },
          { prompt: CURATED_PROMPTS[0], picks: 9 },
        ],
      },
    ]);

    // An artist with no live song left is not public, whatever its own status.
    await t.mutation(internal.content.setSongStatus, { slug: "hey-ya-outkast", status: "held" });
    expect((await readAll(t, "artists"))[0].songs.map((s: any) => s.slug)).toEqual(["ms-jackson-outkast"]);
    await t.mutation(internal.content.setSongStatus, { slug: "ms-jackson-outkast", status: "held" });
    expect(await readAll(t, "artists")).toEqual([]);
    expect((await readAll(t, "charts"))[0].lists.mostPickedArtists).toEqual([]);
  });

  test("charts: the latest week without a note, then approved weeks, newest first", async () => {
    const t = await publishedBank();
    let charts = await readAll(t, "charts");
    expect(charts).toHaveLength(1);
    expect(charts[0]).toMatchObject({
      week: "2026-W46",
      weekStart: "2026-11-09",
      weekEnd: "2026-11-15",
      isLatest: true,
      note: null,
      approvedAt: null,
    });
    expect(charts[0].lists.mostPickedSongs[0]).toEqual({
      rank: 1,
      slug: "hey-ya-outkast",
      title: "Hey Ya!",
      artist: "OutKast",
      artistSlug: "outkast",
      value: 40,
    });
    expect(charts[0].lists.mostPickedArtists).toEqual([{ rank: 1, slug: "outkast", name: "OutKast", value: 52 }]);
    expect(charts[0].lists.movers).toBeNull();

    // A draft note is never returned.
    await t.mutation(internal.content.setChartNote, { week: "2026-W46", note: "  Secret draft.  " });
    charts = await readAll(t, "charts");
    expect(charts[0]).toMatchObject({ note: null, approvedAt: null });
    expect(JSON.stringify(charts)).not.toContain("Secret draft");

    // W47 becomes the latest; W46 has no approved note, so it drops out.
    await runWeekly(t, { week: "2026-W47" });
    charts = await readAll(t, "charts");
    expect(charts.map((c) => [c.week, c.isLatest])).toEqual([["2026-W47", true]]);

    const approved = await t.mutation(internal.content.approveChartNote, { week: "2026-W46" });
    expect(approved).toMatchObject({ approved: true, approvedAt: Date.now() });
    charts = await readAll(t, "charts");
    expect(charts.map((c) => [c.week, c.isLatest, c.note])).toEqual([
      ["2026-W47", true, null],
      ["2026-W46", false, "Secret draft."],
    ]);
    expect(charts[1].approvedAt).toBe(approved.approvedAt);

    // Editing an approved note withdraws it until it is approved again.
    await t.mutation(internal.content.setChartNote, { week: "2026-W46", note: "Rewritten." });
    expect((await readAll(t, "charts")).map((c) => c.week)).toEqual(["2026-W47"]);
    await expect(t.mutation(internal.content.approveChartNote, { week: "2026-W45" })).rejects.toThrow();
    await expect(t.mutation(internal.content.approveChartNote, { week: "2026-W47" })).rejects.toThrow();
  });

  test("a song held by hand leaves the songs section and every chart, and can come back", async () => {
    const t = await publishedBank();
    expect(await t.mutation(internal.content.setSongStatus, { slug: "september-earth-wind-and-fire", status: "held" })).toEqual({
      slug: "september-earth-wind-and-fire",
      status: "held",
      changed: true,
    });
    expect((await readAll(t, "songs")).map((s) => s.slug)).not.toContain("september-earth-wind-and-fire");
    const [chart] = await readAll(t, "charts");
    expect(chart.lists.mostPickedSongs.map((r: any) => [r.rank, r.slug])).toEqual([
      [1, "hey-ya-outkast"],
      [2, "friday-rebecca-black"],
      [3, "ms-jackson-outkast"],
    ]);
    expect(JSON.stringify(chart)).not.toContain("September");

    // The weekly job never lifts a hand hold and never changes the slug.
    await runWeekly(t, { week: "2026-W46" });
    expect((await table(t, "publishedSongs")).find((s) => s.slug === "september-earth-wind-and-fire")).toMatchObject({
      status: "held",
      heldReason: "manual",
    });

    await t.mutation(internal.content.setSongStatus, { slug: "september-earth-wind-and-fire", status: "live" });
    expect((await readAll(t, "songs")).map((s) => s.slug)).toContain("september-earth-wind-and-fire");
    await expect(t.mutation(internal.content.setSongStatus, { slug: "nope", status: "live" })).rejects.toThrow();
  });

  test("a song's title, artist and year can be corrected by hand and stay corrected", async () => {
    const t = await publishedBank();
    const slug = "september-earth-wind-and-fire";
    expect(await t.mutation(internal.content.setSongDetails, { slug, year: 1979 })).toEqual({
      slug,
      title: "September",
      artist: "Earth, Wind & Fire",
      year: 1979,
      changed: true,
    });
    expect(await t.mutation(internal.content.setSongDetails, { slug, year: 1979 })).toMatchObject({ changed: false });
    expect(await t.mutation(internal.content.setSongDetails, { slug, title: "  September (single)  ", artist: "EWF" })).toMatchObject({
      title: "September (single)",
      artist: "EWF",
      year: 1979,
      changed: true,
    });

    // A later run changes none of it, and the slug and artist link stay put.
    await runWeekly(t, { week: "2026-W47" });
    expect((await readAll(t, "songs")).find((s) => s.slug === slug)).toMatchObject({
      title: "September (single)",
      artist: "EWF",
      artistSlug: "earth-wind-and-fire",
      year: 1979,
    });
    const [chart] = await readAll(t, "charts");
    expect(chart.lists.mostPickedSongs.find((r: any) => r.slug === slug)).toMatchObject({ title: "September (single)", artist: "EWF" });
    expect((await table(t, "publishedSongs")).find((s) => s.slug === slug)).toMatchObject({
      songKey: "earth wind and fire|september",
      status: "live",
      mbid: "mbid-September-1978-11-18",
    });

    expect(await t.mutation(internal.content.setSongDetails, { slug, year: null })).toMatchObject({ year: null, changed: true });
    expect((await readAll(t, "songs")).find((s) => s.slug === slug)).toMatchObject({ year: null });

    await expect(t.mutation(internal.content.setSongDetails, { slug: "nope", year: 2000 })).rejects.toThrow();
    await expect(t.mutation(internal.content.setSongDetails, { slug, title: "   " })).rejects.toThrow();
    await expect(t.mutation(internal.content.setSongDetails, { slug, artist: "x".repeat(301) })).rejects.toThrow();
    for (const year of [999, 2101, 2016.5]) {
      await expect(t.mutation(internal.content.setSongDetails, { slug, year })).rejects.toThrow();
    }
  });

  test("a held song with no MusicBrainz names can be named by hand before it goes live", async () => {
    const t = await publishedBank();
    const slug = "unknown-jam-nobody-band";
    await t.mutation(internal.content.setSongDetails, { slug, title: "Unknown Jam", artist: "Nobody Band", year: 2020 });
    expect(await t.mutation(internal.content.setArtistName, { slug: "nobody-band", name: " Nobody Band " })).toEqual({
      slug: "nobody-band",
      name: "Nobody Band",
      changed: true,
    });
    expect(await t.mutation(internal.content.setArtistName, { slug: "nobody-band", name: "Nobody Band" })).toMatchObject({ changed: false });
    await t.mutation(internal.content.setSongStatus, { slug, status: "live" });
    await t.mutation(internal.content.setArtistStatus, { slug: "nobody-band", status: "live" });

    expect((await readAll(t, "songs")).find((s) => s.slug === slug)).toMatchObject({
      title: "Unknown Jam",
      artist: "Nobody Band",
      artistSlug: "nobody-band",
      year: 2020,
    });
    expect((await readAll(t, "artists")).find((a) => a.slug === "nobody-band")).toMatchObject({ name: "Nobody Band" });

    await expect(t.mutation(internal.content.setArtistName, { slug: "nope", name: "X" })).rejects.toThrow();
    await expect(t.mutation(internal.content.setArtistName, { slug: "nobody-band", name: "" })).rejects.toThrow();
  });

  test("an artist held by hand stays held through later runs", async () => {
    const t = await publishedBank();
    await t.mutation(internal.content.setArtistStatus, { slug: "outkast", status: "held" });
    expect(await readAll(t, "artists")).toEqual([]);
    await runWeekly(t, { week: "2026-W47" });
    expect(await readAll(t, "artists")).toEqual([]);
    expect((await readAll(t, "charts"))[0].lists.mostPickedArtists).toEqual([]);
  });

  test("holding an artist takes their songs off every page and list without holding the songs", async () => {
    const t = await publishedBank();
    await t.mutation(internal.content.setArtistStatus, { slug: "outkast", status: "held" });

    const expectHidden = async () => {
      const all = { songs: await readAll(t, "songs"), artists: await readAll(t, "artists"), charts: await readAll(t, "charts") };
      expect(all.songs.map((s) => s.slug).sort()).toEqual(["friday-rebecca-black", "september-earth-wind-and-fire"]);
      expect(all.artists).toEqual([]);
      const text = JSON.stringify(all);
      for (const gone of ["OutKast", "outkast", "Hey Ya", "Ms. Jackson"]) expect(text).not.toContain(gone);
      return all.charts[0].lists;
    };

    // Stored lists still hold the songs; they drop out at read time and the rows below move up.
    let lists = await expectHidden();
    expect(lists.mostPickedSongs.map((r: any) => [r.rank, r.slug])).toEqual([
      [1, "september-earth-wind-and-fire"],
      [2, "friday-rebecca-black"],
    ]);
    expect(lists.highestRated.map((r: any) => r.slug)).toEqual(["september-earth-wind-and-fire", "friday-rebecca-black"]);
    expect(lists.mostDivisive.map((r: any) => r.slug)).toEqual(["friday-rebecca-black", "september-earth-wind-and-fire"]);

    // The songs' own rows are untouched.
    const rows = (await table(t, "publishedSongs")).filter((s) => s.artistSlug === "outkast");
    expect(rows.map((s) => [s.slug, s.status, s.heldReason]).sort()).toEqual([
      ["hey-ya-outkast", "live", undefined],
      ["ms-jackson-outkast", "live", undefined],
    ]);

    // The next run leaves them out of the stored lists and of the ranks, and counts no movers for them.
    await setPicks(t, "Hey Ya!", "OutKast", 80);
    await runWeekly(t, { week: "2026-W47" });
    lists = await expectHidden();
    expect(lists.movers).toEqual([]);
    const stored = (await table(t, "chartWeeks")).find((c) => c.week === "2026-W47")!.lists;
    expect(stored.mostPickedSongs.map((r) => r.slug)).toEqual(["september-earth-wind-and-fire", "friday-rebecca-black"]);
    expect((await readAll(t, "songs")).map((s) => [s.slug, s.rank]).sort()).toEqual([
      ["friday-rebecca-black", 2],
      ["september-earth-wind-and-fire", 1],
    ]);
    expect((await table(t, "publishedSongs")).filter((s) => s.artistSlug === "outkast").map((s) => s.status)).toEqual(["live", "live"]);

    // Lifting the hold brings the artist and the songs back.
    await t.mutation(internal.content.setArtistStatus, { slug: "outkast", status: "live" });
    expect((await readAll(t, "songs")).map((s) => s.slug)).toContain("hey-ya-outkast");
    expect((await readAll(t, "artists")).map((a) => a.slug)).toEqual(["outkast"]);
  });

  test("an artist below the bar has no page but their songs stay public", async () => {
    const t = await publishedBank();
    expect((await table(t, "publishedArtists")).find((a) => a.slug === "rebecca-black")).toMatchObject({
      status: "held",
      heldReason: "below_bar",
    });
    expect((await readAll(t, "songs")).find((s) => s.slug === "friday-rebecca-black")).toMatchObject({ artistSlug: "rebecca-black" });
    expect((await readAll(t, "charts"))[0].lists.mostPickedSongs.map((r: any) => r.slug)).toContain("friday-rebecca-black");
  });

  test("a song or artist whose name was never confirmed cannot be set live by hand", async () => {
    const t = await publishedBank();
    const slug = "unknown-jam-nobody-band";
    const live = (s: string) => t.mutation(internal.content.setSongStatus, { slug: s, status: "live" });
    const artistLive = () => t.mutation(internal.content.setArtistStatus, { slug: "nobody-band", status: "live" });

    await expect(live(slug)).rejects.toThrow("setSongDetails");
    // A year, or one name alone, is not enough.
    await t.mutation(internal.content.setSongDetails, { slug, year: 2020 });
    await expect(live(slug)).rejects.toThrow("setSongDetails");
    await t.mutation(internal.content.setSongDetails, { slug, title: "Unknown Jam" });
    await expect(live(slug)).rejects.toThrow("setSongDetails");
    expect((await table(t, "publishedSongs")).find((s) => s.slug === slug)).toMatchObject({ status: "held", heldReason: "no_match" });
    expect(JSON.stringify(await readAll(t, "songs"))).not.toContain("nobody");

    // Typing the same text as the key half still confirms it.
    expect(await t.mutation(internal.content.setSongDetails, { slug, artist: "nobody band" })).toMatchObject({ changed: false });
    expect(await live(slug)).toMatchObject({ changed: true });
    expect((await readAll(t, "songs")).find((s) => s.slug === slug)).toMatchObject({ title: "Unknown Jam", artist: "nobody band" });

    await expect(artistLive()).rejects.toThrow("setArtistName");
    expect(await t.mutation(internal.content.setArtistName, { slug: "nobody-band", name: "nobody band" })).toMatchObject({ changed: false });
    expect(await artistLive()).toMatchObject({ changed: true });

    // Rows named by MusicBrainz need nothing: hold and lift freely.
    await t.mutation(internal.content.setSongStatus, { slug: "hey-ya-outkast", status: "held" });
    expect(await live("hey-ya-outkast")).toMatchObject({ changed: true });
    await t.mutation(internal.content.setArtistStatus, { slug: "earth-wind-and-fire", status: "live" });
  });

  test("returns no held row, no unapproved note and none of the internal fields", async () => {
    const t = await publishedBank();
    await t.mutation(internal.content.setChartNote, { week: "2026-W46", note: "Unapproved words." });
    const all = {
      songs: await readAll(t, "songs"),
      artists: await readAll(t, "artists"),
      charts: await readAll(t, "charts"),
    };
    expect(all.songs.length).toBeGreaterThan(0);
    expect(all.artists.length).toBeGreaterThan(0);
    expect(all.charts.length).toBeGreaterThan(0);

    const text = JSON.stringify(all);
    // Stored songStats strings, the held song and the draft note.
    for (const leak of ["yt-raw", "cover-leak", "leak-source", "Unknown Jam", "unknown jam", "unknown-jam", "nobody", "Unapproved"]) {
      expect(text).not.toContain(leak);
    }
    // Song keys ("artist|title") never appear.
    expect(text).not.toContain("|");

    const keys = keysOf(all);
    for (const forbidden of [
      "songKey", "artistKey", "mbid", "albumCover", "sources", "status", "heldReason", "noteStatus", "ratingSum", "_id",
      "_creationTime", "publishedAt", "releaseGroupId", "coverStorageId", "photoStorageId", "coverCheckedAt",
      "photoCheckedAt", "coverSetByHand", "photoSetByHand",
    ]) {
      expect(keys.has(forbidden)).toBe(false);
    }
    expect([...keysOf(all.songs)].sort()).toEqual(
      ["artist", "artistSlug", "average", "image", "picks", "prompt", "rank", "ratingCount", "ratingHist", "slug", "title", "topPrompts", "wins", "year"].sort()
    );
    expect([...keysOf(all.artists)].sort()).toEqual(
      ["average", "image", "name", "picks", "prompt", "ratingCount", "slug", "songs", "title", "topPrompts"].sort()
    );
    expect([...keysOf(all.charts)].sort()).toEqual(
      [
        "approvedAt", "artist", "artistSlug", "computedAt", "highestRated", "isLatest", "lists", "mostDivisive",
        "mostPickedArtists", "mostPickedSongs", "movers", "name", "note", "rank", "slug", "title", "value", "week",
        "weekEnd", "weekStart",
      ].sort()
    );
  });

  test("pages through more songs than one page holds", async () => {
    const t = setup();
    await t.run(async (ctx) => {
      for (let i = 0; i < 230; i++) {
        const slug = `song-${String(i).padStart(3, "0")}-band`;
        await ctx.db.insert("publishedSongs", {
          songKey: `band|song ${i}`,
          slug,
          title: `Song ${i}`,
          artist: "Band",
          artistSlug: "band",
          status: i % 23 === 0 ? "held" : "live",
          publishedAt: 1,
        });
        await ctx.db.insert("publishedSongStats", {
          slug,
          picks: i,
          wins: 0,
          ratingCount: 0,
          ratingSum: 0,
          ratingHist: [0, 0, 0, 0, 0],
          rank: 1,
          topPrompts: [],
          computedAt: 1,
        });
      }
    });
    const first = await t.query(api.content.published, { section: "songs" });
    expect(first.items).toHaveLength(100);
    expect(first.cursor).not.toBeNull();
    const songs = await readAll(t, "songs");
    expect(songs).toHaveLength(220);
    expect(new Set(songs.map((s) => s.slug)).size).toBe(220);
    expect(songs[0]).toMatchObject({ average: null, year: null });
    expect(await t.query(api.content.published, { section: "charts" })).toEqual({ items: [], cursor: null });
  });
});

describe("note approval and the deploy hook", () => {
  async function draftedWeek() {
    const t = setup();
    stubFetch(CATALOG);
    await seedBank(t);
    await runWeekly(t, { week: "2026-W46" });
    // The run's own rebuild is out of the way before a test sets the hook URL.
    await settle(t.finishAllScheduledFunctions(vi.runAllTimers));
    await t.mutation(internal.content.setChartNote, { week: "2026-W46", note: "Ready." });
    return t;
  }

  test("approval POSTs the hook URL once", async () => {
    const t = await draftedWeek();
    vi.stubEnv("VERCEL_DEPLOY_HOOK_URL", "https://hooks.example/deploy/abc");
    const calls = stubFetch();
    await t.mutation(internal.content.approveChartNote, { week: "2026-W46" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(calls.map((c) => [c.url.href, c.method])).toEqual([["https://hooks.example/deploy/abc", "POST"]]);

    // Approving again changes nothing and does not rebuild.
    expect(await t.mutation(internal.content.approveChartNote, { week: "2026-W46" })).toMatchObject({ approved: false });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(calls).toHaveLength(1);
  });

  test("approval without the variable skips the request", async () => {
    const t = await draftedWeek();
    vi.stubEnv("VERCEL_DEPLOY_HOOK_URL", "");
    const calls = stubFetch();
    await t.mutation(internal.content.approveChartNote, { week: "2026-W46" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(calls).toHaveLength(0);
    expect(await t.action(internal.content.triggerDeploy, {})).toEqual({ triggered: false, status: null });
    expect((await readAll(t, "charts"))[0].note).toBe("Ready.");
  });

  test("an empty note clears the draft", async () => {
    const t = await draftedWeek();
    expect(await t.mutation(internal.content.setChartNote, { week: "2026-W46", note: "   " })).toEqual({ week: "2026-W46", noteStatus: "none" });
    await expect(t.mutation(internal.content.approveChartNote, { week: "2026-W46" })).rejects.toThrow();
    await expect(t.mutation(internal.content.setChartNote, { week: "2026-W46", note: "x".repeat(5001) })).rejects.toThrow();
  });
});

// --- Images ---

const RG = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const OUTKAST_ID = "73fdb566-a9b1-494c-9f32-51768ec9fd27";
const HEY_YA_RG = RG(1);
const MS_JACKSON_RG = RG(2);

/** A recording as a search returns it, with its artist id and its releases. */
function recWithIds(title: string, artist: string, date: string, artistId: string | null, releaseGroup: string | null): Recording {
  return {
    ...rec(title, artist, date),
    "artist-credit": [artistId ? { name: artist, artist: { id: artistId } } : { name: artist }],
    releases: releaseGroup
      ? [
          // A later compilation, then the release the cover is taken from.
          { id: "rel-b", date: "2016-11-18", "release-group": { id: RG(99) } },
          { id: "rel-a", date, "release-group": { id: releaseGroup } },
        ]
      : [],
  };
}

// The catalog of seedBank, with ids for the two OutKast songs only.
const CATALOG_WITH_IDS: Record<string, Recording[]> = {
  ...CATALOG,
  "outkast|hey ya": [recWithIds("Hey Ya!", "OutKast", "2003-09-23", OUTKAST_ID, HEY_YA_RG)],
  "outkast|ms jackson": [recWithIds("Ms. Jackson", "OutKast", "2000-10-03", OUTKAST_ID, MS_JACKSON_RG)],
};

/** The first bytes of a JPEG of the given size: enough to read its dimensions. */
function jpeg(width: number, height: number, padTo = 0): Uint8Array<ArrayBuffer> {
  const head = [
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08,
    height >> 8, height & 255, width >> 8, width & 255, 0x01, 0x01, 0x11, 0x00, 0xff, 0xd9,
  ];
  const bytes = new Uint8Array(Math.max(head.length, padTo));
  bytes.set(head);
  return bytes;
}
function png(width: number, height: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

const image = (bytes: Uint8Array<ArrayBuffer>, type = "image/jpeg") =>
  new Response(bytes, { status: 200, headers: { "content-type": type } });
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
const redirect = (location: string, status = 307) => new Response(null, { status, headers: { location } });
const notFound = () => new Response("Not Found", { status: 404 });

type Route = (url: URL) => Response | Promise<Response> | undefined;

/** Answers by host and path; anything no route answers is a 404. */
const web =
  (...routes: Route[]) =>
  async (url: URL) => {
    for (const route of routes) {
      const res = await route(url);
      if (res) return res;
    }
    return notFound();
  };

/** The Cover Art Archive as it answers: two redirects into archive.org, then the file. */
const coverArchive =
  (covers: Record<string, () => Response>): Route =>
  (url) => {
    if (url.host === "coverartarchive.org") {
      const m = /^\/release-group\/([0-9a-f-]+)\/front-250$/.exec(url.pathname);
      return m && covers[m[1]] ? redirect(`https://archive.org/download/mbid-${m[1]}/thumb250.jpg`) : notFound();
    }
    if (url.host === "archive.org") {
      return redirect(`https://ia800100.us.archive.org/9${url.pathname.replace("/download", "")}`, 302);
    }
    if (url.host === "ia800100.us.archive.org") {
      const m = /mbid-([0-9a-f-]+)\//.exec(url.pathname);
      return m && covers[m[1]] ? covers[m[1]]() : notFound();
    }
    return undefined;
  };

const COMMONS_PAGE = "https://commons.wikimedia.org/wiki/File:OutKast_2014.jpg";
const THUMB = "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/OutKast_2014.jpg/320px-OutKast_2014.jpg";

/** MusicBrainz artist -> Wikidata -> Commons -> the file, for OutKast. */
const outkastPhoto =
  (license: string, file: () => Response = () => image(png(320, 213), "image/png")): Route =>
  (url) => {
    if (url.host === "musicbrainz.org" && url.pathname === `/ws/2/artist/${OUTKAST_ID}`) {
      expect(url.searchParams.get("inc")).toBe("url-rels");
      return json({
        id: OUTKAST_ID,
        relations: [
          { type: "discogs", url: { resource: "https://www.discogs.com/artist/1" } },
          { type: "wikidata", url: { resource: "https://www.wikidata.org/wiki/Q472595" } },
        ],
      });
    }
    if (url.host === "www.wikidata.org" && url.pathname === "/wiki/Special:EntityData/Q472595.json") {
      return json({
        entities: {
          Q472595: {
            claims: {
              P18: [
                { rank: "deprecated", mainsnak: { datavalue: { value: "Old.jpg" } } },
                { rank: "normal", mainsnak: { datavalue: { value: "OutKast 2014.jpg" } } },
              ],
            },
          },
        },
      });
    }
    if (url.host === "commons.wikimedia.org" && url.pathname === "/w/api.php") {
      expect(Object.fromEntries(url.searchParams)).toEqual({
        action: "query",
        titles: "File:OutKast 2014.jpg",
        prop: "imageinfo",
        iiprop: "url|extmetadata",
        iiurlwidth: "320",
        format: "json",
      });
      return json({
        query: {
          pages: {
            "123": {
              title: "File:OutKast 2014.jpg",
              imageinfo: [
                {
                  thumburl: THUMB,
                  thumbwidth: 320,
                  thumbheight: 213,
                  url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/OutKast_2014.jpg",
                  descriptionurl: COMMONS_PAGE,
                  extmetadata: {
                    Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:Sry85">Sven  Mandel</a> &amp; friends' },
                    LicenseShortName: { value: license },
                  },
                },
              ],
            },
          },
        },
      });
    }
    if (url.href === THUMB) return file();
    return undefined;
  };

const imageCalls = (calls: Call[]) => calls.filter((c) => c.url.pathname !== "/ws/2/recording");
const fileExists = (t: T, id: any) => t.run(async (ctx) => (await ctx.db.system.get(id)) !== null);
const songRow = async (t: T, slug: string) => (await table(t, "publishedSongs")).find((r) => r.slug === slug)!;
const artistRow = async (t: T, slug: string) => (await table(t, "publishedArtists")).find((r) => r.slug === slug)!;

describe("image sources", () => {
  test("only the fixed hosts are allowed, over https", () => {
    for (const host of ["musicbrainz.org", "coverartarchive.org", "www.wikidata.org", "commons.wikimedia.org", "upload.wikimedia.org", "archive.org", "ia800100.us.archive.org"]) {
      expect(isAllowedHost(host), host).toBe(true);
      expect(allowedUrl(`https://${host}/x.jpg`)?.hostname, host).toBe(host);
    }
    for (const host of ["evilarchive.org", "archive.org.evil.example", "wikidata.org", "en.wikipedia.org", "i.ytimg.com", "i1.sndcdn.com"]) {
      expect(isAllowedHost(host), host).toBe(false);
    }
    for (const url of ["http://archive.org/x.jpg", "https://user:pw@archive.org/x.jpg", "https://archive.org:8443/x.jpg", "not a url", ""]) {
      expect(allowedUrl(url), url).toBeNull();
    }
  });

  test("accepts CC0, public domain, CC BY and CC BY-SA in any version, and nothing else", () => {
    for (const name of ["CC0", "CC0 1.0", "Public domain", "CC BY 2.0", "CC BY 4.0", "CC BY-SA 3.0", "CC BY-SA 4.0", "CC BY-SA 2.0 de", "cc by-sa 2.5", "CC BY"]) {
      expect(acceptedLicense(name), name).toBe(true);
    }
    for (const name of ["CC BY-NC 2.0", "CC BY-NC-SA 4.0", "CC BY-ND 2.0", "CC BY-NC-ND 4.0", "Fair use", "GFDL", "Copyrighted", "", "CC BY-SA 4.0 or later, all rights reserved"]) {
      expect(acceptedLicense(name), name).toBe(false);
    }
  });

  test("an author is reduced to capped plain text", () => {
    expect(plainText('<a href="/wiki/User:A" title="x">Ann  B.</a>\n&amp; <i>C&#39;D</i>&nbsp;&#x263A;')).toBe("Ann B. & C'D ☺");
    expect(plainText("x".repeat(500))).toHaveLength(MAX_CREDIT);
    expect(plainText(undefined)).toBe("");
  });

  test("reads the size of a JPEG, PNG, GIF and WebP and refuses anything else", () => {
    expect(imageSize(jpeg(250, 248))).toEqual({ contentType: "image/jpeg", width: 250, height: 248 });
    expect(imageSize(png(320, 213))).toEqual({ contentType: "image/png", width: 320, height: 213 });
    const gif = new Uint8Array(13);
    gif.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x40, 0x01, 0xf0, 0x00]);
    expect(imageSize(gif)).toEqual({ contentType: "image/gif", width: 320, height: 240 });
    const webp = new Uint8Array(30);
    webp.set(new TextEncoder().encode("RIFF"), 0);
    webp.set(new TextEncoder().encode("WEBPVP8X"), 8);
    webp.set([0x3f, 0x01, 0x00, 0xd4, 0x00, 0x00], 24);
    expect(imageSize(webp)).toEqual({ contentType: "image/webp", width: 320, height: 213 });
    expect(imageSize(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(imageSize(new TextEncoder().encode("<!doctype html><html></html>"))).toBeNull();
    expect(imageSize(jpeg(0, 10))).toBeNull();
    expect(imageSize(new Uint8Array(0))).toBeNull();
  });

  test("a match carries the release group of its earliest release and the artist's id", () => {
    const key = "outkast|hey ya";
    expect(pickRecording(key, { recordings: CATALOG_WITH_IDS[key] })).toEqual({
      title: "Hey Ya!",
      artist: "OutKast",
      year: 2003,
      mbid: "mbid-Hey Ya!-2003-09-23",
      releaseGroupId: HEY_YA_RG,
      artistMbid: OUTKAST_ID,
    });
    // Ids that are not MusicBrainz ids are dropped; an undated release sorts last.
    const odd = recWithIds("Hey Ya!", "OutKast", "2003-09-23", "../../etc", null);
    odd.releases = [
      { id: "r1", "release-group": { id: RG(7) } },
      { id: "r2", date: "2004", "release-group": { id: "not-a-uuid" } },
      { id: "r3", date: "2005-01-01", "release-group": { id: RG(8) } },
    ];
    expect(pickRecording(key, { recordings: [odd] })).toEqual({
      title: "Hey Ya!",
      artist: "OutKast",
      year: 2003,
      mbid: "mbid-Hey Ya!-2003-09-23",
      releaseGroupId: RG(8),
    });
  });

  test("a featured credit gives the lead artist's id; a joint credit published whole gives none", () => {
    const lead = credited("a", 100, "FE!N", TRAVIS, "2023-07-28");
    lead["artist-credit"][0].artist = { id: RG(11) };
    lead["artist-credit"][1].artist = { id: RG(12) };
    expect(pickRecording("travis scott|fe n", { recordings: [lead] })).toMatchObject({ artist: "Travis Scott", artistMbid: RG(11) });

    const joint = credited("b", 100, "Senorita", ["Shawn Mendes", " & ", "Camila Cabello"], "2019-06-21");
    joint["artist-credit"][0].artist = { id: RG(13) };
    const match = pickRecording(songKey("Senorita", "Shawn Mendes & Camila Cabello")!, { recordings: [joint] });
    expect(match).toMatchObject({ artist: "Shawn Mendes & Camila Cabello" });
    expect(match).not.toHaveProperty("artistMbid");
  });
});

describe("song covers", () => {
  test("a matched song's cover is stored and returned, through archive.org redirects", async () => {
    const t = setup();
    const calls = stubFetch(CATALOG_WITH_IDS, 200, web(coverArchive({ [HEY_YA_RG]: () => image(jpeg(250, 248)) })));
    await seedBank(t);
    const summary = await runWeekly(t, { week: "2026-W46" });
    expect(summary.images).toEqual({ coversStored: 1, photosStored: 0, notFound: 2, failed: 0, remaining: 0, error: null });

    const row = await songRow(t, "hey-ya-outkast");
    expect(row).toMatchObject({ releaseGroupId: HEY_YA_RG, coverWidth: 250, coverHeight: 248 });
    expect(await fileExists(t, row.coverStorageId)).toBe(true);
    expect(await t.run((ctx) => ctx.db.system.get(row.coverStorageId!))).toMatchObject({ size: jpeg(250, 248).byteLength });

    const songs = await readAll(t, "songs");
    expect(songs.find((s) => s.slug === "hey-ya-outkast").image).toEqual({
      url: expect.stringMatching(/^https:\/\/.+\/api\/storage\/.+/),
      width: 250,
      height: 248,
    });
    expect(songs.filter((s) => s.slug !== "hey-ya-outkast").map((s) => s.image)).toEqual([null, null, null]);

    // Every request went to an allowed host with the MusicBrainz User-Agent,
    // at least the pacing interval after the one before it.
    expect(imageCalls(calls).map((c) => c.url.host)).toEqual([
      "coverartarchive.org", "archive.org", "ia800100.us.archive.org", // Hey Ya!
      "musicbrainz.org", // OutKast, the artist: no Wikidata link in this stub
      "coverartarchive.org", // Ms. Jackson: 404
    ]);
    expect(imageCalls(calls)[0].url.href).toBe(coverUrl(HEY_YA_RG));
    expect(calls.every((c) => isAllowedHost(c.url.host) && c.userAgent === MUSICBRAINZ_USER_AGENT)).toBe(true);
    for (let i = 1; i < calls.length; i++) {
      expect(calls[i].at - calls[i - 1].at).toBeGreaterThanOrEqual(REQUEST_INTERVAL_MS);
    }
  });

  test("a 404 is remembered and asked again only after four weeks", async () => {
    const t = setup();
    const calls = stubFetch(CATALOG_WITH_IDS, 200, web(coverArchive({})));
    await seedBank(t);
    const caa = () => calls.filter((c) => c.url.host === "coverartarchive.org").length;

    await runWeekly(t, { week: "2026-W46" });
    expect(caa()).toBe(2);
    const checkedAt = (await songRow(t, "hey-ya-outkast")).coverCheckedAt!;
    expect(checkedAt).toBeGreaterThan(0);
    expect((await songRow(t, "hey-ya-outkast")).coverStorageId).toBeUndefined();

    await runWeekly(t, { week: "2026-W46" });
    await runWeekly(t, { week: "2026-W47" });
    await runWeekly(t, { week: "2026-W49" });
    expect(caa()).toBe(2);
    expect(Date.now() - checkedAt).toBeLessThan(IMAGE_RETRY_INTERVAL_MS);

    const later = await runWeekly(t, { week: "2026-W51" });
    expect(Date.now() - checkedAt).toBeGreaterThan(IMAGE_RETRY_INTERVAL_MS);
    expect(caa()).toBe(4);
    // Due again: the two covers, the two songs without a release group and OutKast's photo.
    expect(later.images).toMatchObject({ coversStored: 0, notFound: 5 });
    expect((await songRow(t, "hey-ya-outkast")).coverCheckedAt).toBeGreaterThan(checkedAt);
  });

  test("a redirect to a host that is not archive.org is not followed", async () => {
    for (const target of ["https://evil.example/cover.jpg", "https://evilarchive.org/cover.jpg", "http://archive.org/cover.jpg", "https://upload.wikimedia.org/cover.jpg"]) {
      const t = setup();
      const calls = stubFetch(
        CATALOG_WITH_IDS,
        200,
        web((url) => (url.host === "coverartarchive.org" ? redirect(target) : url.host === "musicbrainz.org" ? undefined : image(jpeg(250, 250))))
      );
      await seedBank(t);
      const summary = await runWeekly(t, { week: "2026-W46" });
      expect(summary.images, target).toMatchObject({ coversStored: 0, notFound: 3, failed: 0 });
      expect(imageCalls(calls).map((c) => c.url.host), target).toEqual(["coverartarchive.org", "musicbrainz.org", "coverartarchive.org"]);
      const row = await songRow(t, "hey-ya-outkast");
      expect(row.coverStorageId, target).toBeUndefined();
      expect(row.coverCheckedAt, target).toBeGreaterThan(0);
    }
  });

  test("an answer that is not an image, or is over 2 MB, is refused", async () => {
    const big = jpeg(250, 250, MAX_IMAGE_BYTES + 1);
    const refused: Record<string, () => Response> = {
      "an HTML page": () => new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } }),
      "image bytes sent as text": () => image(jpeg(250, 250), "text/plain"),
      "an image type on bytes that are not an image": () => image(new TextEncoder().encode("<svg/>"), "image/svg+xml"),
      "a declared length over the limit": () =>
        new Response(jpeg(250, 250), { status: 200, headers: { "content-type": "image/jpeg", "content-length": String(MAX_IMAGE_BYTES + 1) } }),
      "a body over the limit": () => image(big),
    };
    for (const [what, answer] of Object.entries(refused)) {
      const t = setup();
      stubFetch(CATALOG_WITH_IDS, 200, web(coverArchive({ [HEY_YA_RG]: answer, [MS_JACKSON_RG]: answer })));
      await seedBank(t);
      const summary = await runWeekly(t, { week: "2026-W46" });
      expect(summary.images, what).toMatchObject({ coversStored: 0, notFound: 3, failed: 0 });
      expect((await songRow(t, "hey-ya-outkast")).coverStorageId, what).toBeUndefined();
      expect(await t.run((ctx) => ctx.db.system.query("_storage").collect()), what).toEqual([]);
    }

    // Exactly at the limit is kept.
    const t = setup();
    stubFetch(CATALOG_WITH_IDS, 200, web(coverArchive({ [HEY_YA_RG]: () => image(jpeg(250, 250, MAX_IMAGE_BYTES)) })));
    await seedBank(t);
    expect((await runWeekly(t, { week: "2026-W46" })).images).toMatchObject({ coversStored: 1 });
  });
});

describe("artist photos", () => {
  const covers = coverArchive({ [HEY_YA_RG]: () => image(jpeg(250, 250)), [MS_JACKSON_RG]: () => image(jpeg(250, 240)) });

  test("a freely licensed Commons photo is stored with its credit", async () => {
    const t = setup();
    const calls = stubFetch(CATALOG_WITH_IDS, 200, web(outkastPhoto("CC BY-SA 4.0"), covers));
    await seedBank(t);
    const summary = await runWeekly(t, { week: "2026-W46" });
    expect(summary.images).toEqual({ coversStored: 2, photosStored: 1, notFound: 0, failed: 0, remaining: 0, error: null });

    const row = await artistRow(t, "outkast");
    expect(row).toMatchObject({
      mbid: OUTKAST_ID,
      photoWidth: 320,
      photoHeight: 213,
      photoAuthor: "Sven Mandel & friends",
      photoLicense: "CC BY-SA 4.0",
      photoPageUrl: COMMONS_PAGE,
    });
    expect(await fileExists(t, row.photoStorageId)).toBe(true);
    expect(imageCalls(calls).filter((c) => !c.url.host.endsWith("archive.org")).map((c) => c.url.host)).toEqual([
      "musicbrainz.org", "www.wikidata.org", "commons.wikimedia.org", "upload.wikimedia.org",
    ]);
    expect(calls.every((c) => isAllowedHost(c.url.host) && c.userAgent === MUSICBRAINZ_USER_AGENT)).toBe(true);

    expect((await readAll(t, "artists"))[0].image).toEqual({
      url: expect.stringMatching(/^https:\/\/.+\/api\/storage\/.+/),
      width: 320,
      height: 213,
      credit: { author: "Sven Mandel & friends", license: "CC BY-SA 4.0", pageUrl: COMMONS_PAGE },
    });
  });

  test("a photo under any other license is refused and the page falls back to the top song's cover", async () => {
    const t = setup();
    const calls = stubFetch(CATALOG_WITH_IDS, 200, web(outkastPhoto("CC BY-NC 2.0"), covers));
    await seedBank(t);
    const summary = await runWeekly(t, { week: "2026-W46" });
    expect(summary.images).toMatchObject({ coversStored: 2, photosStored: 0, notFound: 1, failed: 0 });
    expect(calls.some((c) => c.url.host === "upload.wikimedia.org")).toBe(false);

    const row = await artistRow(t, "outkast");
    expect(row.photoStorageId).toBeUndefined();
    expect(row.photoCheckedAt).toBeGreaterThan(0);

    // Hey Ya! is OutKast's most picked live song: its cover, without a credit.
    const heyYa = (await readAll(t, "songs")).find((s) => s.slug === "hey-ya-outkast").image;
    expect(heyYa).toMatchObject({ width: 250, height: 250 });
    expect((await readAll(t, "artists"))[0].image).toEqual({ ...heyYa, credit: null });

    // Without that cover the artist has no image, whatever the other songs have.
    await t.mutation(internal.content.removeSongCover, { slug: "hey-ya-outkast" });
    expect((await readAll(t, "artists"))[0].image).toBeNull();

    // Not asked again inside the interval.
    const before = calls.length;
    await runWeekly(t, { week: "2026-W47" });
    expect(imageCalls(calls.slice(before))).toEqual([]);
  });

  test("an artist without a Wikidata link, an image claim or a Commons file has no photo", async () => {
    const missing: Record<string, Route> = {
      "no wikidata relation": (url) => (url.pathname.startsWith("/ws/2/artist/") ? json({ relations: [] }) : undefined),
      "no P18 claim": (url) => (url.host === "www.wikidata.org" ? json({ entities: { Q472595: { claims: {} } } }) : undefined),
      "file unknown to Commons": (url) =>
        url.host === "commons.wikimedia.org" ? json({ query: { pages: { "-1": { title: "File:OutKast 2014.jpg", missing: "" } } } }) : undefined,
      "thumb on another host": (url) =>
        url.host === "commons.wikimedia.org"
          ? json({
              query: {
                pages: {
                  "1": {
                    imageinfo: [
                      {
                        thumburl: "https://archive.org/x.jpg",
                        descriptionurl: COMMONS_PAGE,
                        extmetadata: { LicenseShortName: { value: "CC0" } },
                      },
                    ],
                  },
                },
              },
            })
          : undefined,
    };
    for (const [what, route] of Object.entries(missing)) {
      const t = setup();
      const calls = stubFetch(CATALOG_WITH_IDS, 200, web(route, outkastPhoto("CC0"), covers));
      await seedBank(t);
      const summary = await runWeekly(t, { week: "2026-W46" });
      expect(summary.images, what).toMatchObject({ photosStored: 0, notFound: 1, failed: 0 });
      expect((await artistRow(t, "outkast")).photoCheckedAt, what).toBeGreaterThan(0);
      expect(calls.some((c) => c.url.host === "upload.wikimedia.org"), what).toBe(false);
    }
  });
});

describe("images in the weekly job", () => {
  test("image hosts that fail do not stop publishing, the chart or the rebuild", async () => {
    const t = setup();
    vi.stubEnv("VERCEL_DEPLOY_HOOK_URL", "https://hooks.example/deploy/abc");
    const calls = stubFetch(CATALOG_WITH_IDS, 200, (url) => {
      if (url.host === "hooks.example") return new Response("", { status: 200 });
      if (url.host === "coverartarchive.org") throw new TypeError("fetch failed");
      return new Response("busy", { status: 503 });
    });
    await seedBank(t);
    const summary = await runWeekly(t, { week: "2026-W46" });
    expect(summary).toMatchObject({ candidates: 5, carriedOver: 0, artistsLifted: ["outkast"], nextPassScheduled: false, deployScheduled: true });
    expect(summary.published.filter((p) => p.status === "live")).toHaveLength(4);
    // Hey Ya!, OutKast and Ms. Jackson each got no answer; three in a row end the step.
    expect(summary.images).toEqual({ coversStored: 0, photosStored: 0, notFound: 0, failed: 3, remaining: 0, error: null });
    // Each was retried on the rule of the recording lookups.
    expect(imageCalls(calls).filter((c) => c.url.host !== "hooks.example")).toHaveLength(3 * (RETRY_WAITS_MS.length + 1));
    expect((await table(t, "chartWeeks"))[0].lists.mostPickedSongs).toHaveLength(4);
    expect(await readAll(t, "songs")).toHaveLength(4);

    // Nothing was remembered, so the next run asks again.
    expect((await songRow(t, "hey-ya-outkast")).coverCheckedAt).toBeUndefined();
    expect((await artistRow(t, "outkast")).photoCheckedAt).toBeUndefined();

    await settle(t.finishAllScheduledFunctions(vi.runAllTimers));
    expect(calls.filter((c) => c.url.host === "hooks.example")).toHaveLength(1);
  });

  test("an image that cannot be stored is counted as failed and the run goes on", async () => {
    const t = setup();
    stubFetch(CATALOG_WITH_IDS, 200, web(coverArchive({ [HEY_YA_RG]: () => image(jpeg(250, 250)) })));
    await seedBank(t);
    // A blob the runtime refuses to construct breaks every store.
    const RealBlob = globalThis.Blob;
    vi.stubGlobal(
      "Blob",
      class {
        constructor() {
          throw new Error("storage is down");
        }
      }
    );
    const summary = await runWeekly(t, { week: "2026-W46" });
    vi.stubGlobal("Blob", RealBlob);
    expect(summary).toMatchObject({ carriedOver: 0, deployScheduled: true });
    expect(summary.images).toMatchObject({ coversStored: 0, failed: 1 });
    expect(await readAll(t, "songs")).toHaveLength(4);
  });

  test("rows published before images existed get their ids from one lookup each, then their images", async () => {
    const t = setup();
    stubFetch(CATALOG);
    await seedBank(t);
    await runWeekly(t, { week: "2026-W46" });
    // As rows written before the image fields existed: no ids, never searched.
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("publishedSongs").collect()) await ctx.db.patch(row._id, { coverCheckedAt: undefined });
      for (const row of await ctx.db.query("publishedArtists").collect()) await ctx.db.patch(row._id, { photoCheckedAt: undefined });
    });

    const covers = coverArchive({ [HEY_YA_RG]: () => image(jpeg(250, 250)), [MS_JACKSON_RG]: () => image(jpeg(250, 240)) });
    const calls = stubFetch(CATALOG_WITH_IDS, 200, web(outkastPhoto("Public domain"), covers));
    const summary = await runWeekly(t, { week: "2026-W46" });
    expect(summary).toMatchObject({ candidates: 0, published: [] });
    // September and Friday have no release group in the catalog: searched, nothing found.
    expect(summary.images).toEqual({ coversStored: 2, photosStored: 1, notFound: 2, failed: 0, remaining: 0, error: null });
    // One recording lookup per live song, none for the artist: Hey Ya!'s lookup gave OutKast's id.
    expect(calls.filter((c) => c.url.pathname === "/ws/2/recording")).toHaveLength(4);
    expect(await songRow(t, "ms-jackson-outkast")).toMatchObject({ releaseGroupId: MS_JACKSON_RG, coverHeight: 240 });
    expect(await artistRow(t, "outkast")).toMatchObject({ mbid: OUTKAST_ID, photoLicense: "Public domain" });
    // Names, years and slugs are not rewritten by the second lookup.
    expect(await songRow(t, "hey-ya-outkast")).toMatchObject({ title: "Hey Ya!", year: 2003, mbid: "mbid-Hey Ya!-2003-09-23" });

    // Everything is settled: a third run requests nothing.
    const before = calls.length;
    await runWeekly(t, { week: "2026-W46" });
    expect(calls.slice(before)).toEqual([]);
  });

  test("a run fetches a bounded number of images and a follow-up pass takes the rest", async () => {
    const t = setup();
    vi.stubEnv("VERCEL_DEPLOY_HOOK_URL", "https://hooks.example/deploy/abc");
    const total = MAX_IMAGES_PER_RUN + 7;
    await t.run(async (ctx) => {
      await ctx.db.insert("publishedArtists", { artistKey: "band", slug: "band", name: "Band", status: "held", heldReason: "below_bar", publishedAt: 1 });
      for (let i = 0; i < total; i++) {
        await ctx.db.insert("publishedSongs", {
          songKey: `band|song ${i}`,
          slug: `song-${i}-band`,
          title: `Song ${i}`,
          artist: "Band",
          artistSlug: "band",
          mbid: `mbid-${i}`,
          releaseGroupId: RG(1000 + i),
          status: "live",
          publishedAt: 1,
        });
      }
    });
    const calls = stubFetch({}, 200, (url) => (url.host === "coverartarchive.org" ? image(jpeg(250, 250)) : new Response("", { status: 200 })));

    const first = await runWeekly(t, { week: "2026-W46" });
    expect(first.images).toEqual({ coversStored: MAX_IMAGES_PER_RUN, photosStored: 0, notFound: 0, failed: 0, remaining: 7, error: null });
    expect(first).toMatchObject({ nextPassScheduled: true, deployScheduled: false });
    expect(calls.filter((c) => c.url.host === "hooks.example")).toHaveLength(0);

    await settle(t.finishAllScheduledFunctions(vi.runAllTimers));
    expect((await table(t, "publishedSongs")).filter((r) => r.coverStorageId)).toHaveLength(total);
    expect(calls.filter((c) => c.url.host === "coverartarchive.org")).toHaveLength(total);
    expect(calls.filter((c) => c.url.host === "hooks.example")).toHaveLength(1);
  });

  test("songs that are not public get no cover: held songs and songs of a held artist", async () => {
    const t = setup();
    const calls = stubFetch(CATALOG_WITH_IDS, 200, web(coverArchive({ [HEY_YA_RG]: () => image(jpeg(250, 250)), [MS_JACKSON_RG]: () => image(jpeg(250, 250)) })));
    await seedBank(t);
    await t.run(async (ctx) => {
      // Publish OutKast by hand first, held, before the job sees the songs.
      await ctx.db.insert("publishedArtists", { artistKey: "outkast", slug: "outkast", name: "OutKast", nameConfirmed: true, status: "held", heldReason: "manual", publishedAt: 1 });
    });
    const summary = await runWeekly(t, { week: "2026-W46" });
    expect(summary.images).toMatchObject({ coversStored: 0, photosStored: 0 });
    expect(calls.some((c) => c.url.host === "coverartarchive.org")).toBe(false);
  });
});

describe("image hand controls", () => {
  const covers = coverArchive({ [HEY_YA_RG]: () => image(jpeg(250, 250)), [MS_JACKSON_RG]: () => image(jpeg(250, 240)) });

  async function withImages() {
    const t = setup();
    stubFetch(CATALOG_WITH_IDS, 200, web(outkastPhoto("CC BY 2.0"), covers));
    await seedBank(t);
    await runWeekly(t, { week: "2026-W46" });
    return t;
  }

  test("a removed cover is deleted and the job does not fetch it again", async () => {
    const t = await withImages();
    const before = await songRow(t, "hey-ya-outkast");
    expect(await t.mutation(internal.content.removeSongCover, { slug: "hey-ya-outkast" })).toEqual({ slug: "hey-ya-outkast", removed: true });
    expect(await fileExists(t, before.coverStorageId)).toBe(false);
    expect(await songRow(t, "hey-ya-outkast")).toMatchObject({ coverSetByHand: true, releaseGroupId: HEY_YA_RG });
    expect((await songRow(t, "hey-ya-outkast")).coverStorageId).toBeUndefined();
    expect((await readAll(t, "songs")).find((s) => s.slug === "hey-ya-outkast").image).toBeNull();

    // More than four weeks on, everything without an image is due again.
    const calls = stubFetch(CATALOG_WITH_IDS, 200, web(covers));
    await runWeekly(t, { week: "2026-W51" });
    expect(calls.length).toBeGreaterThan(0);
    expect(imageCalls(calls)).toEqual([]);
    expect((await songRow(t, "hey-ya-outkast")).coverStorageId).toBeUndefined();

    expect(await t.mutation(internal.content.removeSongCover, { slug: "hey-ya-outkast" })).toEqual({ slug: "hey-ya-outkast", removed: false });
    await expect(t.mutation(internal.content.removeSongCover, { slug: "nope" })).rejects.toThrow(/No published song/);
  });

  test("a removed photo is deleted with its credit, is not fetched again, and the top cover takes its place", async () => {
    const t = await withImages();
    const before = await artistRow(t, "outkast");
    expect(before.photoStorageId).toBeDefined();
    expect(await t.mutation(internal.content.removeArtistPhoto, { slug: "outkast" })).toEqual({ slug: "outkast", removed: true });
    expect(await fileExists(t, before.photoStorageId)).toBe(false);
    const after = await artistRow(t, "outkast");
    expect(after).toMatchObject({ photoSetByHand: true, mbid: OUTKAST_ID });
    for (const field of ["photoStorageId", "photoAuthor", "photoLicense", "photoPageUrl", "photoWidth"] as const) {
      expect(after[field], field).toBeUndefined();
    }
    expect((await readAll(t, "artists"))[0].image).toMatchObject({ width: 250, height: 250, credit: null });

    const calls = stubFetch(CATALOG_WITH_IDS, 200, web(outkastPhoto("CC0"), covers));
    await runWeekly(t, { week: "2026-W51" });
    expect(calls.length).toBeGreaterThan(0);
    expect(imageCalls(calls)).toEqual([]);
    await expect(t.mutation(internal.content.removeArtistPhoto, { slug: "nope" })).rejects.toThrow(/No published artist/);
  });

  test("a cover set from a URL replaces the stored one and is kept by later runs", async () => {
    const t = await withImages();
    const before = await songRow(t, "hey-ya-outkast");
    const calls = stubFetch({}, 200, (url) => (url.href === "https://archive.org/download/x/cover.png" ? image(png(500, 500), "image/png") : notFound()));

    expect(await settle(t.action(internal.content.setSongCoverFromUrl, { slug: "hey-ya-outkast", url: "https://archive.org/download/x/cover.png" }))).toEqual({
      slug: "hey-ya-outkast",
      width: 500,
      height: 500,
    });
    const after = await songRow(t, "hey-ya-outkast");
    expect(after).toMatchObject({ coverWidth: 500, coverHeight: 500, coverSetByHand: true });
    expect(after.coverStorageId).not.toBe(before.coverStorageId);
    expect(await fileExists(t, before.coverStorageId)).toBe(false);
    expect(await fileExists(t, after.coverStorageId)).toBe(true);
    expect(calls.map((c) => [c.url.host, c.userAgent])).toEqual([["archive.org", MUSICBRAINZ_USER_AGENT]]);

    // A URL off the allowlist is refused before any request; so is a non-image.
    const none = stubFetch({}, 200, () => new Response("<html/>", { status: 200, headers: { "content-type": "text/html" } }));
    for (const url of ["https://i.ytimg.com/vi/abc/hq720.jpg", "https://i1.sndcdn.com/artworks-x.jpg", "http://archive.org/x.jpg", "https://example.com/x.jpg"]) {
      await expect(settle(t.action(internal.content.setSongCoverFromUrl, { slug: "hey-ya-outkast", url }))).rejects.toThrow(/allowed image host/);
    }
    expect(none).toEqual([]);
    await expect(settle(t.action(internal.content.setSongCoverFromUrl, { slug: "hey-ya-outkast", url: "https://archive.org/x.jpg" }))).rejects.toThrow(/Image refused: not an image/);
    expect((await songRow(t, "hey-ya-outkast")).coverStorageId).toBe(after.coverStorageId);

    // An unknown slug stores nothing.
    stubFetch({}, 200, () => image(png(10, 10), "image/png"));
    await expect(settle(t.action(internal.content.setSongCoverFromUrl, { slug: "nope", url: "https://archive.org/x.png" }))).rejects.toThrow(/No published song/);
    expect(await t.run((ctx) => ctx.db.system.query("_storage").collect())).toHaveLength(3); // two covers, one photo
  });

  test("a photo set from a URL carries the credit given with it", async () => {
    const t = await withImages();
    const before = await artistRow(t, "outkast");
    stubFetch({}, 200, () => image(jpeg(320, 400)));
    const args = {
      slug: "outkast",
      url: "https://upload.wikimedia.org/wikipedia/commons/thumb/b/bc/Big_Boi.jpg/320px-Big_Boi.jpg",
      author: "  Jane   Doe ",
      license: "CC BY 4.0",
      pageUrl: "https://commons.wikimedia.org/wiki/File:Big_Boi.jpg",
    };
    expect(await settle(t.action(internal.content.setArtistPhotoFromUrl, args))).toEqual({ slug: "outkast", width: 320, height: 400 });
    expect(await fileExists(t, before.photoStorageId)).toBe(false);
    expect(await artistRow(t, "outkast")).toMatchObject({ photoSetByHand: true, photoAuthor: "Jane Doe" });
    expect((await readAll(t, "artists"))[0].image).toMatchObject({
      width: 320,
      height: 400,
      credit: { author: "Jane Doe", license: "CC BY 4.0", pageUrl: "https://commons.wikimedia.org/wiki/File:Big_Boi.jpg" },
    });

    const calls = stubFetch({}, 200, () => image(jpeg(320, 400)));
    await expect(settle(t.action(internal.content.setArtistPhotoFromUrl, { ...args, pageUrl: "https://example.com/photo" }))).rejects.toThrow(/commons\.wikimedia\.org/);
    await expect(settle(t.action(internal.content.setArtistPhotoFromUrl, { ...args, author: " " }))).rejects.toThrow(/author is empty/);
    await expect(settle(t.action(internal.content.setArtistPhotoFromUrl, { ...args, license: "x".repeat(MAX_CREDIT + 1) }))).rejects.toThrow(/license is longer/);
    await expect(settle(t.action(internal.content.setArtistPhotoFromUrl, { ...args, url: "https://example.com/a.jpg" }))).rejects.toThrow(/allowed image host/);
    expect(calls).toEqual([]);
  });
});
