// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { ARTISTS, CHARTS, SONGS } from "./content.fixture";
import { loadPublishedContent } from "./loadContent";

const URL = "https://example.convex.cloud";

const ok = (value) => ({ ok: true, status: 200, json: async () => ({ status: "success", value }) });

/** A fetch that serves each section in pages of `pageSize`, like the query. */
function pagedFetch(sections, pageSize = 2) {
  return vi.fn(async (_url, init) => {
    const { args } = JSON.parse(init.body);
    const all = sections[args.section];
    const start = args.cursor ? Number(args.cursor) : 0;
    const end = start + pageSize;
    return ok({ items: all.slice(start, end), cursor: end < all.length ? String(end) : null });
  });
}

describe("loadPublishedContent", () => {
  it("reads every section through the Convex HTTP API until the cursor is null", async () => {
    const fetchImpl = pagedFetch({ songs: SONGS, artists: ARTISTS, charts: CHARTS });
    const content = await loadPublishedContent(`${URL}/`, fetchImpl);
    expect(content).toEqual({ songs: SONGS, artists: ARTISTS, charts: CHARTS });

    const calls = fetchImpl.mock.calls.map(([url, init]) => ({ url, method: init.method, body: JSON.parse(init.body) }));
    expect(calls.every((call) => call.url === `${URL}/api/query` && call.method === "POST")).toBe(true);
    expect(calls.map((call) => call.body)).toEqual([
      { path: "content:published", args: { section: "songs" }, format: "json" },
      { path: "content:published", args: { section: "songs", cursor: "2" }, format: "json" },
      { path: "content:published", args: { section: "artists" }, format: "json" },
      { path: "content:published", args: { section: "charts" }, format: "json" },
      { path: "content:published", args: { section: "charts", cursor: "2" }, format: "json" },
    ]);
  });

  it("fails when the deployment URL is missing", async () => {
    await expect(loadPublishedContent("", vi.fn())).rejects.toThrow(/VITE_CONVEX_URL is not set/);
    await expect(loadPublishedContent(undefined, vi.fn())).rejects.toThrow(/VITE_CONVEX_URL is not set/);
  });

  it("fails when the request fails", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    });
    await expect(loadPublishedContent(URL, fetchImpl)).rejects.toThrow(/fetching songs .* failed: getaddrinfo ENOTFOUND/);
  });

  it("fails on a non-200 response", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    await expect(loadPublishedContent(URL, fetchImpl)).rejects.toThrow(/HTTP 503/);
  });

  it("fails when the query reports an error", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: "error", errorMessage: "Could not find public function" }),
    }));
    await expect(loadPublishedContent(URL, fetchImpl)).rejects.toThrow(/Could not find public function/);
  });

  it("fails on a value that is not { items, cursor }", async () => {
    await expect(loadPublishedContent(URL, vi.fn(async () => ok([])))).rejects.toThrow(/unexpected shape/);
    await expect(loadPublishedContent(URL, vi.fn(async () => ok({ items: [] })))).rejects.toThrow(/unexpected shape/);
  });

  it("fails when a later section fails, even with songs in hand", async () => {
    const good = pagedFetch({ songs: SONGS, artists: ARTISTS, charts: CHARTS });
    const fetchImpl = vi.fn(async (url, init) => {
      if (JSON.parse(init.body).args.section === "charts") return { ok: false, status: 500, json: async () => ({}) };
      return good(url, init);
    });
    await expect(loadPublishedContent(URL, fetchImpl)).rejects.toThrow(/fetching charts .* HTTP 500/);
  });

  it("fails on zero songs", async () => {
    const fetchImpl = pagedFetch({ songs: [], artists: ARTISTS, charts: CHARTS });
    await expect(loadPublishedContent(URL, fetchImpl)).rejects.toThrow(/returned zero songs/);
  });

  it("fails when the cursor never advances", async () => {
    const fetchImpl = vi.fn(async () => ok({ items: SONGS, cursor: "same" }));
    await expect(loadPublishedContent(URL, fetchImpl)).rejects.toThrow(/repeated a cursor/);
  });
});
