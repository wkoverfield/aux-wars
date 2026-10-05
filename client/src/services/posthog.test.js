import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POSTHOG_EVENTS, campaignParamsFrom, isAllowedEvent, sanitizeEvent, syncPostHogConsent } from "./posthog";

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

describe("deferred PostHog loading", () => {
  let idleCallbacks;

  beforeEach(() => {
    idleCallbacks = [];
    window.requestIdleCallback = vi.fn((cb) => idleCallbacks.push(cb));
    localStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  afterEach(() => {
    delete window.requestIdleCallback;
    vi.unstubAllEnvs();
    vi.doUnmock("posthog-js");
    vi.resetModules();
    localStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  function makePostHog() {
    return {
      init: vi.fn(),
      capture: vi.fn(),
      register_for_session: vi.fn(),
      has_opted_out_capturing: vi.fn(() => false),
      opt_in_capturing: vi.fn(),
      opt_out_capturing: vi.fn(),
    };
  }

  async function loadModule({ factory } = {}) {
    vi.resetModules();
    vi.stubEnv("VITE_POSTHOG_KEY", "phc_test");
    const client = makePostHog();
    const importer = vi.fn(factory || (() => ({ default: client })));
    vi.doMock("posthog-js", importer);
    const mod = await import("./posthog");
    return { mod, client, importer };
  }

  const loaded = (client) => vi.waitFor(() => expect(client.init).toHaveBeenCalledOnce());

  it("does not fetch the SDK at startup", async () => {
    const { mod, importer } = await loadModule();

    mod.initPostHog();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(importer).not.toHaveBeenCalled();
    expect(window.requestIdleCallback).toHaveBeenCalledWith(expect.any(Function), { timeout: 3000 });
  });

  it("loads on the idle callback with replay sampling, no autocapture, no surveys", async () => {
    const { mod, client } = await loadModule();

    mod.initPostHog();
    idleCallbacks[0]();
    await loaded(client);

    const config = client.init.mock.calls[0][1];
    expect(config.autocapture).toBe(false);
    expect(config.disable_surveys).toBe(true);
    expect(config.session_recording.sampleRate).toBe(0.2);
    expect(config.before_send).toBe(mod.sanitizeEvent);
  });

  it("loads on the first route change away from the landing page", async () => {
    const { mod, client, importer } = await loadModule();

    mod.initPostHog();
    mod.notifyRouteChange(); // initial render, same page
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(importer).not.toHaveBeenCalled();

    window.history.pushState(null, "", "/lobby/ABC123");
    mod.notifyRouteChange();
    await loaded(client);
  });

  it("buffers captures without loading, then loads once across triggers", async () => {
    const { mod, client, importer } = await loadModule();

    mod.initPostHog();
    mod.capture("host_game_clicked");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(importer).not.toHaveBeenCalled();
    window.history.pushState(null, "", "/lobby/ABC123");
    mod.notifyRouteChange();
    idleCallbacks[0]();
    await loaded(client);

    expect(client.init).toHaveBeenCalledOnce();
  });

  it("replays buffered captures with their original timestamps and page", async () => {
    const { mod, client } = await loadModule();
    mod.initPostHog();

    window.history.pushState(null, "", "/lobby/ABC123");
    const before = Date.now();
    mod.capture("game_created", { player_count: 1 });
    mod.capture("rating_submitted", { rating_value: 5 }); // not allowlisted
    idleCallbacks[0]();
    await loaded(client);

    const funnel = client.capture.mock.calls.filter(([event]) => event === "game_created");
    expect(funnel).toHaveLength(1);
    const [, props, options] = funnel[0];
    expect(props).toMatchObject({ player_count: 1, $pathname: "/lobby/ABC123" });
    expect(props.$current_url).toContain("/lobby/ABC123");
    expect(options.timestamp).toBeInstanceOf(Date);
    expect(options.timestamp.getTime()).toBeGreaterThanOrEqual(before);
    expect(client.capture.mock.calls.some(([event]) => event === "rating_submitted")).toBe(false);
  });

  it("caps the buffer at 50 captures", async () => {
    const { mod, client } = await loadModule();
    mod.initPostHog();

    for (let i = 0; i < 60; i += 1) mod.capture("round_completed", { i });
    idleCallbacks[0]();
    await loaded(client);

    expect(client.capture.mock.calls.filter(([event]) => event === "round_completed")).toHaveLength(50);
  });

  it("forwards captures directly once loaded", async () => {
    const { mod, client } = await loadModule();
    mod.initPostHog();
    idleCallbacks[0]();
    await loaded(client);

    mod.capture("game_started", { player_count: 4 });

    expect(client.capture).toHaveBeenLastCalledWith("game_started", { player_count: 4 });
  });

  it("drops the buffer when consent is rejected before the SDK loads", async () => {
    const { mod, client, importer } = await loadModule();
    mod.initPostHog();

    // Buffer while the import is in flight, then reject.
    mod.capture("session_start");
    idleCallbacks[0]();
    localStorage.setItem("aux-wars-cookie-consent", "rejected");
    window.dispatchEvent(new Event("aux-wars-consent-changed"));
    await loaded(client);

    expect(importer).toHaveBeenCalledOnce();
    expect(client.opt_out_capturing).toHaveBeenCalledOnce();
    expect(client.capture).not.toHaveBeenCalled();
  });

  it("does not buffer or fetch while consent is rejected", async () => {
    localStorage.setItem("aux-wars-cookie-consent", "rejected");
    const { mod, importer } = await loadModule();
    mod.initPostHog();

    mod.capture("session_start");
    idleCallbacks[0]();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(importer).not.toHaveBeenCalled();
  });

  it("swallows an import failure and stays a no-op", async () => {
    const { mod, importer } = await loadModule({
      factory: () => {
        throw new Error("Failed to fetch dynamically imported module");
      },
    });
    mod.initPostHog();

    idleCallbacks[0]();
    await vi.waitFor(() => expect(importer).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(() => mod.capture("game_started")).not.toThrow();
    mod.notifyRouteChange();
    idleCallbacks[0]?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    // No retry loop; an unhandled rejection would fail this run in vitest.
    expect(importer).toHaveBeenCalledOnce();
  });

  it("keeps the landing URL's campaign params and referrer after an early navigation", async () => {
    window.history.replaceState(null, "", "/?utm_source=test&utm_campaign=launch&gclid=abc&ref=x");
    vi.spyOn(document, "referrer", "get").mockReturnValue("https://news.example.com/post");
    const { mod, client } = await loadModule();
    mod.initPostHog();

    window.history.pushState(null, "", "/lobby/ABC123");
    mod.notifyRouteChange();
    await loaded(client);

    expect(client.register_for_session).toHaveBeenCalledWith({
      utm_source: "test",
      utm_campaign: "launch",
      gclid: "abc",
      $referrer: "https://news.example.com/post",
      $referring_domain: "news.example.com",
    });
    const landing = client.capture.mock.calls.find(([event]) => event === "$pageview");
    expect(landing[1]).toMatchObject({ $pathname: "/" });
    expect(landing[1].$current_url).toContain("utm_source=test");
    expect(landing[2].timestamp).toBeInstanceOf(Date);
    vi.restoreAllMocks();
  });

  it("leaves attribution to posthog-js when nothing navigated before load", async () => {
    window.history.replaceState(null, "", "/?utm_source=test");
    const { mod, client } = await loadModule();
    mod.initPostHog();
    idleCallbacks[0]();
    await loaded(client);

    expect(client.register_for_session).not.toHaveBeenCalled();
    expect(client.capture).not.toHaveBeenCalled();
  });
});

describe("campaignParamsFrom", () => {
  it("keeps utm and click-id params only", () => {
    expect(
      campaignParamsFrom("https://aux-wars.com/?utm_source=a&utm_medium=b&fbclid=c&code=XYZ&utm_term=")
    ).toEqual({ utm_source: "a", utm_medium: "b", fbclid: "c" });
  });

  it("returns nothing for an unparseable url", () => {
    expect(campaignParamsFrom("not a url")).toEqual({});
  });
});
