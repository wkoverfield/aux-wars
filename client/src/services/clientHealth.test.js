import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const inpOpts = vi.fn();
vi.mock("web-vitals/attribution", () => ({
  onLCP: (cb) => cb({ name: "LCP", value: 2345.6, rating: "good" }),
  onINP: (_cb, opts) => inpOpts(opts),
  onCLS: (cb) => cb({ name: "CLS", value: 0.12345, rating: "needs-improvement" }),
  onFCP: () => {},
  onTTFB: () => {},
}));

import {
  __resetClientHealthForTests,
  deviceClass,
  errorName,
  errorOrigin,
  initClientHealth,
  interactionLabel,
  noteInteraction,
  notedLabelAt,
  scriptSource,
  reportBoundaryError,
  reportClientError,
  routePattern,
  vitalMetadata,
} from "./clientHealth";

function fakeClient() {
  return { mutation: vi.fn(() => Promise.resolve({ success: true })) };
}

const sent = (client) => client.mutation.mock.calls.map(([, args]) => args);

beforeEach(() => {
  __resetClientHealthForTests();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  __resetClientHealthForTests();
});

describe("routePattern", () => {
  it("removes room codes and keeps known routes", () => {
    expect(routePattern("/")).toBe("/");
    expect(routePattern("/privacy/")).toBe("/privacy");
    expect(routePattern("/pro/success")).toBe("/pro/success");
    expect(routePattern("/lobby/ABC123")).toBe("/lobby/:code");
    expect(routePattern("/lobby/ABC123/round")).toBe("/lobby/:code/round");
    expect(routePattern("/lobby/ABC123/gamewinner")).toBe("/lobby/:code/gamewinner");
    expect(routePattern("/lobby/ABC123/other")).toBe("other");
    expect(routePattern("/g/abcdefgh2345")).toBe("/g/:id");
    // Same pages in another case never leak the code or id as "other" detail.
    expect(routePattern("/G/abcdefgh2345")).toBe("/g/:id");
    expect(routePattern("/LOBBY/ABC123")).toBe("/lobby/:code");
    expect(routePattern("/Lobby/ABC123/Round")).toBe("/lobby/:code/round");
    expect(routePattern("/some/unknown/path")).toBe("other");
  });
});

describe("deviceClass", () => {
  it("buckets by user agent", () => {
    expect(deviceClass({ userAgent: "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0)" })).toBe("chromebook");
    expect(deviceClass({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Mobile/15E148" })).toBe("mobile");
    expect(deviceClass({ userAgent: "Mozilla/5.0 (Linux; Android 14) Mobile Safari" })).toBe("mobile");
    expect(deviceClass({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" })).toBe("desktop");
    expect(deviceClass(undefined)).toBe("desktop");
  });
});

describe("errorName", () => {
  it("keeps the class name only", () => {
    expect(errorName(new TypeError("secret"))).toBe("TypeError");
    expect(errorName("a string reason", "UnhandledRejection")).toBe("UnhandledRejection");
    expect(errorName({ name: "has spaces in it" })).toBe("Error");
  });

  it("names Convex, stale-chunk and network failures by kind, not message", () => {
    expect(errorName(new Error("[CONVEX M(game/flow:startGame)] [Request ID: abc] Server Error"))).toBe("ConvexServerError");
    expect(errorName(new TypeError("Failed to fetch dynamically imported module: https://x/assets/a.js"))).toBe("ChunkLoadError");
    expect(errorName(new TypeError("Importing a module script failed."))).toBe("ChunkLoadError");
    expect(errorName(new TypeError("Failed to fetch"))).toBe("NetworkError");
    expect(errorName(new TypeError("Load failed"))).toBe("NetworkError");
    expect(errorName(new TypeError("x is undefined"))).toBe("TypeError");
  });
});

describe("errorOrigin", () => {
  const origin = "https://aux-wars.com";
  const err = (stack) => Object.assign(new Error("x"), { stack });

  it("gives the app bundle position from the first stack frame (Chrome and Safari formats)", () => {
    expect(
      errorOrigin(err("ReferenceError: x is not defined\n    at onClick (https://aux-wars.com/assets/index-D9bxC1pi.js:42:13337)\n    at a (https://aux-wars.com/assets/index-D9bxC1pi.js:1:5)"), undefined, origin)
    ).toEqual({ script: "app", label: "index-D9bxC1pi:42:13337" });
    expect(errorOrigin(err("onClick@https://aux-wars.com/assets/Round-AbC_12-x.js:7:99\n@https://aux-wars.com/x.js:1:1"), undefined, origin))
      .toEqual({ script: "app", label: "Round-AbC_12-x:7:99" });
  });

  it("never turns a page URL into a position (a lobby path ends in the room code)", () => {
    for (const url of [
      "https://aux-wars.com/lobby/ABC123",
      "https://aux-wars.com/lobby/ABC123/round",
      "https://aux-wars.com/stats",
      "https://aux-wars.com/",
      "https://aux-wars.com/assets/ABC123.js",
      "https://aux-wars.com/other/index-D9bxC1pi.js",
    ]) {
      expect(errorOrigin(err(`at f (${url}:5:10)`), undefined, origin)).toEqual({ script: "app" });
    }
  });

  it("buckets other sources without a position", () => {
    expect(errorOrigin(err("at f (chrome-extension://abcdef/content.js:1:2)"), undefined, origin)).toEqual({ script: "extension" });
    expect(errorOrigin(err("at f (https://www.youtube.com/s/player/base.js:10:20)"), undefined, origin)).toEqual({ script: "youtube" });
    expect(errorOrigin(err("at f (https://cdn.example.com/lib.js:3:4)"), undefined, origin)).toEqual({ script: "third-party" });
  });

  it("falls back to an error event's script URL, and to nothing", () => {
    expect(errorOrigin(null, "https://aux-wars.com/assets/index-D9bxC1pi.js", origin)).toEqual({ script: "app" });
    expect(errorOrigin(null, "", origin)).toEqual({});
    expect(errorOrigin("a string reason", undefined, origin)).toEqual({});
    expect(errorOrigin(err("Error: no frames here"), undefined, origin)).toEqual({});
  });
});

describe("interactionLabel", () => {
  it("joins up to two data-vital names with the control's tag", () => {
    document.body.innerHTML = `
      <div data-vital="round"><div data-vital="rating"><div data-vital="record">
        <button><span id="hit">Velvet Bassline</span></button>
      </div></div></div>
      <div data-vital="lobby"><input id="name" /></div>
      <p id="plain">text</p>
      <div data-vital="Bad Name!"><a id="link">x</a></div>`;
    expect(interactionLabel(document.getElementById("hit"))).toBe("rating>record:button");
    expect(interactionLabel(document.getElementById("hit").firstChild)).toBe("rating>record:button");
    expect(interactionLabel(document.getElementById("name"))).toBe("lobby:input");
    expect(interactionLabel(document.getElementById("plain"))).toBe(":p");
    expect(interactionLabel(document.getElementById("link"))).toBe(":a");
    expect(interactionLabel(null)).toBeUndefined();
    document.body.innerHTML = "";
  });
});

describe("scriptSource", () => {
  it("buckets the longest script's URL", () => {
    const origin = "https://aux-wars.com";
    expect(scriptSource("https://aux-wars.com/assets/index-abc.js", origin)).toBe("app");
    expect(scriptSource("https://www.youtube.com/s/player/x/base.js", origin)).toBe("youtube");
    expect(scriptSource("https://i.ytimg.com/x.js", origin)).toBe("youtube");
    expect(scriptSource("chrome-extension://abc/content.js", origin)).toBe("extension");
    expect(scriptSource("https://pagead2.googlesyndication.com/x.js", origin)).toBe("third-party");
    expect(scriptSource("", origin)).toBeUndefined();
  });
});

describe("vitalMetadata", () => {
  it("rounds values and attaches route, device and connection", () => {
    window.history.replaceState(null, "", "/lobby/XYZ999/round");
    const nav = { userAgent: "CrOS", connection: { effectiveType: "3g" } };
    expect(vitalMetadata({ name: "INP", value: 212.6, rating: "needs-improvement" }, nav)).toEqual({
      name: "INP",
      value: 213,
      rating: "needs-improvement",
      route: "/lobby/:code/round",
      deviceClass: "chromebook",
      effectiveType: "3g",
    });
    expect(vitalMetadata({ name: "CLS", value: 0.04567, rating: "good" }, { userAgent: "" })).toEqual({
      name: "CLS",
      value: 0.046,
      rating: "good",
      route: "/lobby/:code/round",
      deviceClass: "desktop",
    });
  });
});

describe("INP attribution", () => {
  it("adds target, interaction type, phases and script source to INP only", () => {
    window.history.replaceState(null, "", "/lobby/XYZ999/round");
    const attribution = {
      interactionTarget: "rating>record:button",
      interactionType: "pointer",
      inputDelay: 12.4,
      processingDuration: 250.6,
      presentationDelay: 40.2,
      longestScript: { entry: { sourceURL: `${location.origin}/assets/index.js` } },
    };
    expect(vitalMetadata({ name: "INP", value: 303, rating: "poor", attribution }, { userAgent: "Android Mobi" })).toEqual({
      name: "INP",
      value: 303,
      rating: "poor",
      route: "/lobby/:code/round",
      deviceClass: "mobile",
      target: "rating>record:button",
      interactionType: "pointer",
      inputDelay: 12,
      processing: 251,
      presentation: 40,
      script: "app",
    });
    expect(vitalMetadata({ name: "LCP", value: 2000, rating: "good", attribution: { target: "img" } }, { userAgent: "" }))
      .not.toHaveProperty("target");
  });
});

describe("noted interaction labels", () => {
  const attribution = (over) => ({ interactionType: "pointer", inputDelay: 1, processingDuration: 2, presentationDelay: 3, ...over });
  const inp = (a) => vitalMetadata({ name: "INP", value: 300, rating: "needs-improvement", attribution: attribution(a) }, { userAgent: "" });

  it("uses the label noted at the tap when the element is gone by report time", () => {
    document.body.innerHTML = `<div data-vital="rating"><button data-vital="submit" id="b">Submit</button></div>`;
    noteInteraction({ target: document.getElementById("b"), timeStamp: 1000 });
    document.body.innerHTML = "";
    expect(inp({ interactionTarget: undefined, interactionTime: 1004 }).target).toBe("rating>submit:button");
    // A CSS path from the library's own fallback is never sent.
    expect(inp({ interactionTarget: "html>body>div#root>button.green-btn", interactionTime: 1004 }).target).toBe("rating>submit:button");
  });

  it("keeps a full label read at report time, and fills in a nameless one", () => {
    document.body.innerHTML = `<div data-vital="lobby"><button data-vital="ready" id="b">Ready</button></div>`;
    noteInteraction({ target: document.getElementById("b"), timeStamp: 500 });
    expect(inp({ interactionTarget: "song-select>search:input", interactionTime: 500 }).target).toBe("song-select>search:input");
    expect(inp({ interactionTarget: ":button", interactionTime: 500 }).target).toBe("lobby>ready:button");
    document.body.innerHTML = "";
  });

  it("matches the nearest note within 100ms and nothing further away", () => {
    document.body.innerHTML = `<div data-vital="a"><button id="x"></button></div><div data-vital="b"><button id="y"></button></div>`;
    noteInteraction({ target: document.getElementById("x"), timeStamp: 1000 });
    noteInteraction({ target: document.getElementById("y"), timeStamp: 1060 });
    expect(notedLabelAt(1050)).toBe("b:button");
    expect(notedLabelAt(1010)).toBe("a:button");
    expect(notedLabelAt(1300)).toBeUndefined();
    expect(inp({ interactionTarget: undefined, interactionTime: 5000 })).not.toHaveProperty("target");
    document.body.innerHTML = "";
  });

  it("keeps only the most recent notes", () => {
    document.body.innerHTML = `<div data-vital="a"><button id="x"></button></div>`;
    for (let i = 0; i < 30; i += 1) noteInteraction({ target: document.getElementById("x"), timeStamp: i * 1000 });
    expect(notedLabelAt(0)).toBeUndefined();
    expect(notedLabelAt(29000)).toBe("a:button");
    document.body.innerHTML = "";
  });
});

describe("error reporting", () => {
  it("does nothing without a client", () => {
    expect(() => reportClientError(new Error("x"))).not.toThrow();
  });

  it("caps uncaught errors at 3 per load and boundary errors separately", () => {
    const client = fakeClient();
    initClientHealth(client, { random: () => 0.99 });
    window.history.replaceState(null, "", "/lobby/ABC123");
    for (let i = 0; i < 5; i++) reportClientError(new RangeError("boom"));
    reportBoundaryError(new TypeError("render failed"));
    expect(sent(client)).toEqual([
      { eventType: "client_error", metadata: { name: "RangeError", route: "/lobby/:code" } },
      { eventType: "client_error", metadata: { name: "RangeError", route: "/lobby/:code" } },
      { eventType: "client_error", metadata: { name: "RangeError", route: "/lobby/:code" } },
      { eventType: "client_error_boundary", metadata: { name: "TypeError", route: "/lobby/:code" } },
    ]);
  });

  it("never throws when the mutation rejects", async () => {
    const client = { mutation: vi.fn(() => Promise.reject(new Error("offline"))) };
    initClientHealth(client, { random: () => 0.99 });
    expect(() => reportClientError(new Error("x"))).not.toThrow();
    await Promise.resolve();
  });
});

describe("web vitals sampling", () => {
  it("passes our label builder to onINP", async () => {
    initClientHealth(fakeClient(), { sampleRate: 1, random: () => 0 });
    await vi.waitFor(() => expect(inpOpts).toHaveBeenCalled());
    expect(inpOpts.mock.calls.at(-1)[0]).toEqual({ generateTarget: interactionLabel });
  });

  it("reports vitals when the load is sampled", async () => {
    const client = fakeClient();
    initClientHealth(client, { random: () => 0.1 });
    await vi.waitFor(() => expect(client.mutation).toHaveBeenCalledTimes(2));
    expect(sent(client).map((a) => [a.eventType, a.metadata.name, a.metadata.value])).toEqual([
      ["web_vital", "LCP", 2346],
      ["web_vital", "CLS", 0.123],
    ]);
  });

  it("reports nothing when the load is not sampled", async () => {
    const client = fakeClient();
    initClientHealth(client, { random: () => 0.5 });
    await new Promise((r) => setTimeout(r, 20));
    expect(client.mutation).not.toHaveBeenCalled();
  });
});
