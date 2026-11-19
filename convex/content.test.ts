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
  isSongCandidate,
  ratingSpread,
  slugPart,
  songSlugBase,
  weekIdFor,
  weekRange,
} from "./contentLib";
import { MAX_LOOKUPS_PER_RUN } from "./contentJob";
import {
  MUSICBRAINZ_USER_AGENT,
  REQUEST_INTERVAL_MS,
  lookupRecording,
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
  "artist-credit": { name: string; joinphrase?: string }[];
  "first-release-date"?: string;
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

type Call = { url: URL; at: number; userAgent: string | null; method: string };

/** Replaces fetch. `catalog` maps a song key to the recordings a search returns. */
function stubFetch(catalog: Record<string, Recording[]> = {}, status = 200) {
  const calls: Call[] = [];
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
      if (url.host !== "musicbrainz.org") return new Response("", { status: 200 });
      if (status !== 200) return new Response(JSON.stringify({ error: "busy" }), { status });
      const m = /^recording:"(.*)" AND artist:"(.*)"$/.exec(url.searchParams.get("query") ?? "");
      const recordings = m ? catalog[`${m[2]}|${m[1]}`] ?? [] : [];
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

const runWeekly = (t: T, args: { week?: string } = {}) =>
  settle(t.action(internal.contentJob.runWeekly, args));

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
    expect(new URL(recordingSearchUrl('a"b|c\\d')).searchParams.get("query")).toBe('recording:"c d" AND artist:"a b"');
  });

  test("a busy server is not a rejection", async () => {
    stubFetch(CATALOG, 503);
    expect(await lookupRecording(key)).toEqual({ kind: "unavailable" });
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
    expect(await table(t, "publishedSongs")).toEqual([]);
    expect(await table(t, "chartWeeks")).toHaveLength(1);

    stubFetch(CATALOG);
    const second = await runWeekly(t, { week: "2026-W46" });
    expect(second.published).toHaveLength(5);
    expect(await table(t, "chartWeeks")).toHaveLength(1);
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
    expect(first).toMatchObject({ candidates: total, carriedOver: 5, nextPassScheduled: true });
    expect(first.published).toHaveLength(MAX_LOOKUPS_PER_RUN);
    expect(calls).toHaveLength(MAX_LOOKUPS_PER_RUN);
    // Paced the whole way: the run took at least a second per lookup.
    expect(calls[calls.length - 1].at - calls[0].at).toBeGreaterThanOrEqual((MAX_LOOKUPS_PER_RUN - 1) * 1000);

    await settle(t.finishAllScheduledFunctions(vi.runAllTimers));
    expect(await table(t, "publishedSongs")).toHaveLength(total);
    expect(calls).toHaveLength(total);
    expect(await table(t, "chartWeeks")).toHaveLength(1);
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
    });
    // Rank counts every song in the bank, held and unpublished included:
    // 40, 30, 20, then the held song at 15 and the unpublished one at 14.
    expect(songs.find((s) => s.slug === "ms-jackson-outkast")).toMatchObject({ rank: 6, topPrompts: [{ prompt: CURATED_PROMPTS[1], picks: 4 }] });
    // artistSlug is present even though that artist has no page.
    expect(songs.find((s) => s.slug === "september-earth-wind-and-fire")).toMatchObject({ artistSlug: "earth-wind-and-fire", year: 1978 });
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

  test("an artist held by hand stays held through later runs", async () => {
    const t = await publishedBank();
    await t.mutation(internal.content.setArtistStatus, { slug: "outkast", status: "held" });
    expect(await readAll(t, "artists")).toEqual([]);
    await runWeekly(t, { week: "2026-W47" });
    expect(await readAll(t, "artists")).toEqual([]);
    expect((await readAll(t, "charts"))[0].lists.mostPickedArtists).toEqual([]);
    // Its songs stay public and keep their artistSlug.
    expect((await readAll(t, "songs")).find((s) => s.slug === "hey-ya-outkast")).toMatchObject({ artistSlug: "outkast" });
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
    for (const forbidden of ["songKey", "artistKey", "mbid", "albumCover", "sources", "status", "heldReason", "noteStatus", "ratingSum", "_id", "_creationTime", "publishedAt"]) {
      expect(keys.has(forbidden)).toBe(false);
    }
    expect([...keysOf(all.songs)].sort()).toEqual(
      ["artist", "artistSlug", "average", "picks", "prompt", "rank", "ratingCount", "ratingHist", "slug", "title", "topPrompts", "wins", "year"].sort()
    );
    expect([...keysOf(all.artists)].sort()).toEqual(
      ["average", "name", "picks", "prompt", "ratingCount", "slug", "songs", "title", "topPrompts"].sort()
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
