import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api } from "./_generated/api";
import presenceComponent from "@convex-dev/presence/test";
import { MAX_SOUNDCLOUD_URL_LENGTH, RATING_TIMEOUT_MS, clipLengthMs } from "./game/flow";

// The three track sources (videoId, soundcloudUrl, previewUrl): what submitSong
// stores, what the rating screen is served, and how long each clip plays.

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./**/*.d.ts"]);

type T = ReturnType<typeof setup>;

function setup() {
  const t = convexTest(schema, modules);
  presenceComponent.register(t, "presence");
  return t;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const conn = (id: string) => `conn-${id}`;
const as = (code: string, id: string) => ({ code, playerId: id, connectionId: conn(id) });

const SOUNDCLOUD_URL = "https://soundcloud.com/forss/flickermood";

type Sources = { videoId?: string; soundcloudUrl?: string; previewUrl?: string };

const track = (id: string, sources: Sources) => ({
  trackId: `qa-${id}`,
  trackDetails: { name: `QA ${id}`, artist: "QA Artist", albumCover: "", ...sources },
});

async function advance(t: T, ms: number) {
  vi.advanceTimersByTime(ms);
  await t.finishInProgressScheduledFunctions();
  for (let i = 0; i < 4; i++) {
    vi.advanceTimersByTime(1);
    await t.finishInProgressScheduledFunctions();
  }
}

/** A private room in song selection for round 1, with one seated player per id. */
async function selectingRoom(t: T, ids: string[]) {
  const { code } = await t.mutation(api.game.rooms.hostGame, {});
  for (const id of ids) {
    const res = await t.mutation(api.game.rooms.joinGame, { ...as(code, id), name: `QA-${id}` });
    expect(res.success).toBe(true);
  }
  await t.run(async (ctx) => {
    const room = await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", code)).unique();
    await ctx.db.patch(room!._id, { phase: "songSelection", currentRound: 1 });
  });
  return code as string;
}

async function submissions(t: T, code: string) {
  return await t.run(async (ctx) =>
    ctx.db.query("submissions").withIndex("by_room_round", (q) => q.eq("roomCode", code).eq("round", 1)).collect()
  );
}

describe("submitSong track sources", () => {
  test("a SoundCloud track is stored and served to the rating screen", async () => {
    const t = setup();
    const code = await selectingRoom(t, ["h", "a"]);
    const snippet = { startTime: 42, endTime: 62 };

    const first = await t.mutation(api.game.flow.submitSong, {
      ...as(code, "h"),
      trackId: "sc:forss/flickermood",
      trackDetails: { name: "Flickermood", artist: "Forss", albumCover: "", soundcloudUrl: SOUNDCLOUD_URL, snippet },
    });
    expect(first).toEqual({ success: true });
    const second = await t.mutation(api.game.flow.submitSong, { ...as(code, "a"), ...track("a", { videoId: "dQw4w9WgXcQ" }) });
    expect(second).toEqual({ success: true });

    const [stored] = await submissions(t, code);
    expect(stored.trackDetails).toEqual({
      name: "Flickermood",
      artist: "Forss",
      albumCover: "",
      soundcloudUrl: SOUNDCLOUD_URL,
      snippet,
    });

    await advance(t, 500);
    const song = await t.query(api.game.flow.getCurrentRatingSong, { code });
    expect(song).toMatchObject({ name: "Flickermood", artist: "Forss", soundcloudUrl: SOUNDCLOUD_URL, snippet });
    expect(song!.videoId).toBeUndefined();
    expect(song!.previewUrl).toBeUndefined();
    expect(song!.player.id).toBe("h");
  });

  test("YouTube and preview tracks are stored without a soundcloudUrl", async () => {
    const t = setup();
    const code = await selectingRoom(t, ["h", "a", "b"]);

    for (const [id, sources] of [
      ["h", { videoId: "dQw4w9WgXcQ" }],
      ["a", { previewUrl: "https://example.test/a.m4a" }],
    ] as const) {
      expect(await t.mutation(api.game.flow.submitSong, { ...as(code, id), ...track(id, sources) })).toEqual({ success: true });
    }

    const stored = await submissions(t, code);
    expect(stored.map((s) => s.trackDetails)).toEqual([
      { name: "QA h", artist: "QA Artist", albumCover: "", videoId: "dQw4w9WgXcQ" },
      { name: "QA a", artist: "QA Artist", albumCover: "", previewUrl: "https://example.test/a.m4a" },
    ]);
  });

  test("a soundcloudUrl that is not a canonical track address is rejected", async () => {
    const t = setup();
    const code = await selectingRoom(t, ["h", "a"]);
    const rejected = [
      "",
      "https://example.com/forss/flickermood",
      "https://soundcloud.com.example.com/forss/flickermood",
      "https://evil.test/https://soundcloud.com/forss/flickermood",
      "https://www.soundcloud.com/forss/flickermood",
      "https://m.soundcloud.com/forss/flickermood",
      "https://on.soundcloud.com/AbCd1234",
      "http://soundcloud.com/forss/flickermood",
      "https://soundcloud.com/forss",
      "https://soundcloud.com/forss/",
      "https://soundcloud.com/forss/sets/soulhack",
      "https://soundcloud.com/forss/sets",
      "https://soundcloud.com/forss/tracks",
      "https://soundcloud.com/forss/flicker mood",
      "https://soundcloud.com/forss/flicker\\mood",
      "https://soundcloud.com/forss/flickermood/",
      "https://soundcloud.com/forss/flickermood?si=SHARE_TOKEN",
      "https://soundcloud.com/forss/flickermood#t=0:30",
      " https://soundcloud.com/forss/flickermood",
      "javascript:alert(1)//https://soundcloud.com/forss/flickermood",
    ];
    for (const soundcloudUrl of rejected) {
      const res = await t.mutation(api.game.flow.submitSong, { ...as(code, "h"), ...track("h", { soundcloudUrl }) });
      expect(res, soundcloudUrl).toMatchObject({ success: false, code: "soundcloud_url_invalid" });
    }
    expect(await submissions(t, code)).toEqual([]);

    // A rejected track does not use up the player's submission or rate limit.
    const ok = await t.mutation(api.game.flow.submitSong, { ...as(code, "h"), ...track("h", { soundcloudUrl: SOUNDCLOUD_URL }) });
    expect(ok).toEqual({ success: true });
  });

  test("a soundcloudUrl over the length limit is rejected on length, whatever its shape", async () => {
    const t = setup();
    const code = await selectingRoom(t, ["h", "a"]);
    const prefix = "https://soundcloud.com/forss/";
    const atLimit = prefix + "t".repeat(MAX_SOUNDCLOUD_URL_LENGTH - prefix.length);
    const overLimit = atLimit + "t";
    const wrongHostOverLimit = "https://example.com/" + "t".repeat(MAX_SOUNDCLOUD_URL_LENGTH);

    for (const soundcloudUrl of [overLimit, wrongHostOverLimit, "x".repeat(100_000)]) {
      const res = await t.mutation(api.game.flow.submitSong, { ...as(code, "h"), ...track("h", { soundcloudUrl }) });
      expect(res).toMatchObject({ success: false, code: "soundcloud_url_too_long" });
    }
    expect(await submissions(t, code)).toEqual([]);

    expect(atLimit).toHaveLength(MAX_SOUNDCLOUD_URL_LENGTH);
    const ok = await t.mutation(api.game.flow.submitSong, { ...as(code, "h"), ...track("h", { soundcloudUrl: atLimit }) });
    expect(ok).toEqual({ success: true });
  });

  test("a track naming more than one source is rejected", async () => {
    const t = setup();
    const code = await selectingRoom(t, ["h", "a"]);
    const videoId = "dQw4w9WgXcQ";
    const previewUrl = "https://example.test/a.m4a";

    for (const sources of [
      { soundcloudUrl: SOUNDCLOUD_URL, videoId },
      { soundcloudUrl: SOUNDCLOUD_URL, previewUrl },
      { videoId, previewUrl },
      { soundcloudUrl: SOUNDCLOUD_URL, videoId, previewUrl },
    ]) {
      const res = await t.mutation(api.game.flow.submitSong, { ...as(code, "h"), ...track("h", sources) });
      expect(res, Object.keys(sources).join("+")).toMatchObject({ success: false, code: "multiple_track_sources" });
    }
    expect(await submissions(t, code)).toEqual([]);
  });

  test("the source check runs before the room is looked at", async () => {
    const t = setup();
    const res = await t.mutation(api.game.flow.submitSong, {
      ...as("NOROOM", "h"),
      ...track("h", { soundcloudUrl: "https://example.com/forss/flickermood" }),
    });
    expect(res).toMatchObject({ success: false, code: "soundcloud_url_invalid" });
  });
});

describe("clip length of a SoundCloud track", () => {
  const base = { name: "x", artist: "y", albumCover: "", soundcloudUrl: SOUNDCLOUD_URL };

  test("its snippet window, when it has one", () => {
    expect(clipLengthMs({ ...base, snippet: { startTime: 42, endTime: 62 } }, 30)).toBe(20_000);
    expect(clipLengthMs({ ...base, snippet: { startTime: 42, endTime: 62 } }, 0)).toBe(20_000);
    expect(clipLengthMs({ ...base, snippet: { startTime: 0, endTime: 300 } }, 0)).toBe(RATING_TIMEOUT_MS);
  });

  test("the whole rating window when the room has no snippet limit", () => {
    expect(clipLengthMs(base, 0)).toBe(RATING_TIMEOUT_MS);
    expect(clipLengthMs({ ...base, snippet: { startTime: 0, endTime: 0 } }, 0)).toBe(RATING_TIMEOUT_MS);
  });

  test("the default clip length otherwise", () => {
    expect(clipLengthMs(base, 30)).toBe(30_000);
    expect(clipLengthMs(base, undefined)).toBe(30_000);
  });
});
