import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("web-vitals", () => ({
  onLCP: (cb) => cb({ name: "LCP", value: 2345.6, rating: "good" }),
  onINP: () => {},
  onCLS: (cb) => cb({ name: "CLS", value: 0.12345, rating: "needs-improvement" }),
  onFCP: () => {},
  onTTFB: () => {},
}));

import {
  __resetClientHealthForTests,
  deviceClass,
  errorName,
  initClientHealth,
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
