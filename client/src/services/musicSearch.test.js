import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Fresh module per test: the cache, pending and backoff maps are module state.
async function load() {
  vi.resetModules();
  return await import("./musicSearch");
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
  };
}

const TRACK = { id: "1", name: "Song", artist: "Artist" };

describe("searchTracks", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("resolves an empty 200 as an empty result, not a failure", async () => {
    const { searchTracks } = await load();
    fetch.mockResolvedValue(jsonResponse({ tracks: [] }));
    await expect(searchTracks("nothing matches")).resolves.toEqual([]);
  });

  it("resolves tracks from a 200", async () => {
    const { searchTracks } = await load();
    fetch.mockResolvedValue(jsonResponse({ tracks: [TRACK] }));
    await expect(searchTracks("song")).resolves.toEqual([TRACK]);
  });

  it("rejects with reason network when fetch throws a TypeError", async () => {
    const { searchTracks, SearchError } = await load();
    fetch.mockRejectedValue(new TypeError("Failed to fetch"));
    const err = await searchTracks("song").catch((e) => e);
    expect(err).toBeInstanceOf(SearchError);
    expect(err.reason).toBe("network");
    expect(err.fromBackoff).toBe(false);
  });

  it("aborts after the timeout and rejects with reason timeout", async () => {
    vi.useFakeTimers();
    const { searchTracks, SEARCH_TIMEOUT_MS } = await load();
    fetch.mockImplementation(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => {
            const err = new Error("The operation was aborted.");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );
    const pending = searchTracks("slow song").catch((e) => e);
    await vi.advanceTimersByTimeAsync(SEARCH_TIMEOUT_MS + 1);
    const err = await pending;
    expect(err.reason).toBe("timeout");
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it("rejects with reason http_503 on a 503", async () => {
    const { searchTracks } = await load();
    fetch.mockResolvedValue(jsonResponse({ error: "Search service temporarily unavailable" }, 503));
    const err = await searchTracks("song").catch((e) => e);
    expect(err.reason).toBe("http_503");
  });

  it("rejects with reason bad_payload when the body is not a track list", async () => {
    const { searchTracks } = await load();
    fetch.mockResolvedValue(jsonResponse({ something: "else" }));
    const err = await searchTracks("song").catch((e) => e);
    expect(err.reason).toBe("bad_payload");

    const again = await load();
    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new SyntaxError("bad json"); } });
    const err2 = await again.searchTracks("song").catch((e) => e);
    expect(err2.reason).toBe("bad_payload");
  });

  it("falls back to stale cached tracks when a refresh fails", async () => {
    vi.useFakeTimers();
    const { searchTracks } = await load();
    fetch.mockResolvedValueOnce(jsonResponse({ tracks: [TRACK] }));
    await expect(searchTracks("song")).resolves.toEqual([TRACK]);

    // Past the cache TTL, the refresh fails: the stale tracks come back.
    vi.advanceTimersByTime(6 * 60 * 1000);
    fetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(searchTracks("song")).resolves.toEqual([TRACK]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("backs off a repeatedly failing query, then retries", async () => {
    vi.useFakeTimers();
    const { searchTracks } = await load();
    fetch.mockRejectedValue(new TypeError("Failed to fetch"));
    for (let i = 0; i < 3; i++) await searchTracks("song").catch(() => {});
    expect(fetch).toHaveBeenCalledTimes(3);

    const backedOff = await searchTracks("song").catch((e) => e);
    expect(backedOff).toMatchObject({ reason: "network", fromBackoff: true });
    expect(fetch).toHaveBeenCalledTimes(3);

    vi.advanceTimersByTime(31 * 1000);
    fetch.mockResolvedValue(jsonResponse({ tracks: [TRACK] }));
    await expect(searchTracks("song")).resolves.toEqual([TRACK]);
  });
});
