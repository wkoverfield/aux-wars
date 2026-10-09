import { useCallback, useEffect, useRef, useState } from "react";
import { searchTracks, getCachedResults, SearchError } from "../../services/musicSearch";

// After this long without an answer, the search shows "Still searching..." and a Retry.
export const SEARCH_SLOW_MS = 3000;
const DEBOUNCE_MS = 350;

/**
 * Song search state for the selection screen: debounced, cached, with a
 * "still searching" flag and a fresh retry. It lives with the search screen
 * so a keystroke re-renders that screen only, not the whole round.
 *
 * `onNoResults(term)` fires for a well-formed empty answer to a query of 3+
 * characters; `onFailed(reason)` fires when the search itself fails (not when
 * it was skipped by the backoff). Both are read through refs, so passing new
 * functions does not restart a search.
 */
export function useSongSearch({ onNoResults, onFailed } = {}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchError, setSearchError] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isSearchSlow, setIsSearchSlow] = useState(false);
  const [searchRetry, setSearchRetry] = useState(0);
  const retryingSearchRef = useRef(false);
  const onNoResultsRef = useRef(onNoResults);
  const onFailedRef = useRef(onFailed);
  onNoResultsRef.current = onNoResults;
  onFailedRef.current = onFailed;

  useEffect(() => {
    setIsSearchSlow(false);
    if (!searchTerm.trim()) {
      setSearchResults([]);
      setSearchError(null);
      setIsSearching(false);
      return undefined;
    }
    const isRetry = retryingSearchRef.current;
    retryingSearchRef.current = false;

    // The spinner covers the debounce and the fetch.
    setIsSearching(true);

    const cachedResults = getCachedResults(searchTerm);
    if (cachedResults) {
      setSearchResults(cachedResults);
      setSearchError(null);
    }

    // A newer keystroke supersedes this search: drop its late results.
    let cancelled = false;
    let slowTimer = null;
    const delayDebounce = setTimeout(async () => {
      slowTimer = setTimeout(() => {
        if (!cancelled) setIsSearchSlow(true);
      }, SEARCH_SLOW_MS);
      try {
        setSearchError(null);
        const result = await searchTracks(searchTerm, { fresh: isRetry });
        if (cancelled) return;

        setSearchResults(result);
        if (result.length === 0) {
          setSearchError("No songs found. Try different keywords.");
          if (searchTerm.trim().length >= 3) onNoResultsRef.current?.(searchTerm.trim());
        } else {
          setSearchError(null);
        }
      } catch (err) {
        if (cancelled) return;
        // The search itself failed (timeout, network, HTTP error, bad payload)
        // and nothing was cached for this query.
        setSearchError("Search service temporarily unavailable. Please try again.");
        setSearchResults([]);
        if (err instanceof SearchError && !err.fromBackoff) onFailedRef.current?.(err.reason);
      } finally {
        clearTimeout(slowTimer);
        if (!cancelled) {
          setIsSearching(false);
          setIsSearchSlow(false);
        }
      }
    }, isRetry ? 0 : DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(delayDebounce);
      clearTimeout(slowTimer);
    };
  }, [searchTerm, searchRetry]);

  const onSearchChange = useCallback((e) => setSearchTerm(e.target.value), []);
  const onRetrySearch = useCallback(() => {
    retryingSearchRef.current = true;
    setSearchRetry((n) => n + 1);
  }, []);

  return { searchTerm, onSearchChange, searchResults, searchError, isSearching, isSearchSlow, onRetrySearch };
}
