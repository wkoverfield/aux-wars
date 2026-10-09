import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const searchTracks = vi.fn();
class SearchError extends Error {
  constructor(reason, { fromBackoff = false } = {}) {
    super(reason);
    this.reason = reason;
    this.fromBackoff = fromBackoff;
  }
}
vi.mock("../../services/musicSearch", () => ({
  searchTracks: (...args) => searchTracks(...args),
  getCachedResults: () => null,
  SearchError,
}));

const { useSongSearch, SEARCH_SLOW_MS } = await import("./useSongSearch");

const type = (result, value) => act(() => result.current.onSearchChange({ target: { value } }));

describe("useSongSearch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    searchTracks.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("offers Retry after 3s without an answer and retries with a fresh request", async () => {
    let resolveRetry;
    searchTracks
      .mockImplementationOnce(() => new Promise(() => {}))
      .mockImplementationOnce(() => new Promise((r) => { resolveRetry = r; }));
    const { result } = renderHook(() => useSongSearch());

    type(result, "song");
    expect(result.current.isSearching).toBe(true);
    await act(async () => { vi.advanceTimersByTime(350); });
    expect(searchTracks).toHaveBeenCalledWith("song", { fresh: false });
    await act(async () => { vi.advanceTimersByTime(SEARCH_SLOW_MS - 1); });
    expect(result.current.isSearchSlow).toBe(false);
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(result.current.isSearchSlow).toBe(true);

    act(() => result.current.onRetrySearch());
    await act(async () => { vi.advanceTimersByTime(0); });
    expect(searchTracks).toHaveBeenCalledTimes(2);
    expect(searchTracks).toHaveBeenLastCalledWith("song", { fresh: true });
    expect(result.current.isSearchSlow).toBe(false);

    await act(async () => { resolveRetry([{ id: "t9" }]); });
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(result.current.isSearchSlow).toBe(false);
    expect(result.current.isSearching).toBe(false);
    expect(result.current.searchResults).toEqual([{ id: "t9" }]);
  });

  it("reports an empty answer for 3+ characters, and a failure with its reason", async () => {
    const onNoResults = vi.fn();
    const onFailed = vi.fn();
    searchTracks
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new SearchError("timeout"))
      .mockRejectedValueOnce(new SearchError("timeout", { fromBackoff: true }));
    const { result } = renderHook(() => useSongSearch({ onNoResults, onFailed }));

    type(result, " zzzq ");
    await act(async () => { vi.advanceTimersByTime(350); });
    expect(onNoResults).toHaveBeenCalledWith("zzzq");
    expect(result.current.searchError).toMatch(/No songs found/);

    type(result, "abc");
    await act(async () => { vi.advanceTimersByTime(350); });
    expect(onFailed).toHaveBeenCalledWith("timeout");
    expect(result.current.searchError).toMatch(/temporarily unavailable/);

    type(result, "abcd");
    await act(async () => { vi.advanceTimersByTime(350); });
    expect(onFailed).toHaveBeenCalledTimes(1); // skipped by the backoff: not a new failure
  });

  it("does not restart a search when the callbacks change", async () => {
    searchTracks.mockResolvedValue([{ id: "t1" }]);
    const { result, rerender } = renderHook((props) => useSongSearch(props), {
      initialProps: { onNoResults: () => {} },
    });

    type(result, "song");
    rerender({ onNoResults: () => {} });
    await act(async () => { vi.advanceTimersByTime(350); });
    expect(searchTracks).toHaveBeenCalledTimes(1);
  });

  it("clears results when the box is emptied", async () => {
    searchTracks.mockResolvedValue([{ id: "t1" }]);
    const { result } = renderHook(() => useSongSearch());

    type(result, "song");
    await act(async () => { vi.advanceTimersByTime(350); });
    expect(result.current.searchResults).toHaveLength(1);

    type(result, "");
    expect(result.current.searchResults).toEqual([]);
    expect(result.current.isSearching).toBe(false);
  });
});
