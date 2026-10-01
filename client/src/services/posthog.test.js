import { afterEach, describe, expect, it, vi } from "vitest";
import { POSTHOG_EVENTS, isAllowedEvent, sanitizeEvent, syncPostHogConsent } from "./posthog";

function makeClient(optedOut = false) {
  return {
    has_opted_out_capturing: vi.fn(() => optedOut),
    opt_in_capturing: vi.fn(),
    opt_out_capturing: vi.fn(),
  };
}

describe("syncPostHogConsent", () => {
  it.each([null, "accepted"])("does nothing when capture is already on (%s)", (consent) => {
    const client = makeClient(false);

    syncPostHogConsent(client, consent);

    expect(client.opt_in_capturing).not.toHaveBeenCalled();
    expect(client.opt_out_capturing).not.toHaveBeenCalled();
  });

  it("opts out only on the transition to rejected", () => {
    const capturing = makeClient(false);
    const alreadyOut = makeClient(true);

    syncPostHogConsent(capturing, "rejected");
    syncPostHogConsent(alreadyOut, "rejected");

    expect(capturing.opt_out_capturing).toHaveBeenCalledOnce();
    expect(alreadyOut.opt_out_capturing).not.toHaveBeenCalled();
  });

  it.each([null, "accepted"])("silently resumes after rejection (%s)", (consent) => {
    const client = makeClient(true);

    syncPostHogConsent(client, consent);

    expect(client.opt_in_capturing).toHaveBeenCalledWith({ captureEventName: false });
    expect(client.opt_out_capturing).not.toHaveBeenCalled();
  });
});

describe("PostHog event allowlist", () => {
  it("is exactly the game funnel", () => {
    expect([...POSTHOG_EVENTS].sort()).toEqual([
      "game_completed_viewed",
      "game_created",
      "game_started",
      "host_game_clicked",
      "lobby_left",
      "play_again_clicked",
      "player_joined",
      "round_completed",
      "session_start",
      "song_search_no_results",
    ]);
  });

  it.each([
    "vote_listen",
    "rating_submitted",
    "rating_started",
    "song_search_started",
    "song_search_completed",
    "song_search_failed",
    "song_selected",
    "song_submitted",
    "clip_window_selected",
    "player_ready_toggled",
    "settings_opened",
    "settings_updated",
    "next_round_clicked",
    "prompt_pack_saved",
    "join_game_attempted",
  ])("drops %s", (event) => {
    expect(isAllowedEvent(event)).toBe(false);
  });

  it("every capture call site in the client uses an allowed event", () => {
    const sources = import.meta.glob(["../**/*.{js,jsx}", "!../**/*.test.{js,jsx}"], {
      query: "?raw",
      import: "default",
      eager: true,
    });
    const callPattern = /\b(?:captureGameEvent|capture)\(\s*["'`]([^"'`]+)["'`]/g;
    const used = new Set();
    for (const source of Object.values(sources)) {
      for (const match of source.matchAll(callPattern)) used.add(match[1]);
    }

    expect(used.size).toBeGreaterThan(0);
    for (const event of used) {
      expect(POSTHOG_EVENTS, `unexpected PostHog event "${event}"`).toContain(event);
    }
  });
});

describe("sanitizeEvent", () => {
  it("masks room codes in urls", () => {
    const event = sanitizeEvent({ properties: { $pathname: "/lobby/ABC123/round", $current_url: "https://aux-wars.com/lobby/ABC123" } });
    expect(event.properties.$pathname).toBe("/lobby/[room]/round");
    expect(event.properties.$current_url).toBe("https://aux-wars.com/lobby/[room]");
  });

  it.each(["/stats", "/stats/"])("drops events from the private stats page (%s)", (path) => {
    expect(sanitizeEvent({ event: "$pageview", properties: { $pathname: path } })).toBeNull();
  });

  it("keeps pages that only start with the same letters", () => {
    expect(sanitizeEvent({ properties: { $pathname: "/statsfoo" } })).not.toBeNull();
  });
});

describe("initPostHog", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("posthog-js");
    vi.resetModules();
  });

  async function loadWithKey() {
    vi.resetModules();
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test");
    const client = {
      init: vi.fn(),
      capture: vi.fn(),
      has_opted_out_capturing: vi.fn(() => false),
      opt_in_capturing: vi.fn(),
      opt_out_capturing: vi.fn(),
    };
    vi.doMock("posthog-js", () => ({ default: client }));
    const mod = await import("./posthog");
    mod.initPostHog();
    return { mod, client };
  }

  it("keeps autocapture off and replays sampled at 20%", async () => {
    const { client } = await loadWithKey();

    expect(client.init).toHaveBeenCalledOnce();
    const config = client.init.mock.calls[0][1];
    expect(config.autocapture).toBe(false);
    expect(config.session_recording.sampleRate).toBe(0.2);
  });

  it("forwards funnel events and drops everything else", async () => {
    const { mod, client } = await loadWithKey();

    mod.capture("game_started", { player_count: 4 });
    mod.capture("rating_submitted", { rating_value: 5 });

    expect(client.capture).toHaveBeenCalledOnce();
    expect(client.capture).toHaveBeenCalledWith("game_started", { player_count: 4 });
  });
});
