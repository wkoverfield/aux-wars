import { memo, useCallback, useDeferredValue, useState } from "react";
import SearchBar from "../../components/SearchBar";
import SongList from "../../components/SongList";
import ScrollFade from "../../components/ScrollFade";
import { useSongSearch } from "./useSongSearch";

/**
 * SongSelection component provides a search interface for selecting songs
 * and displays search results in a list.
 * 
 * @param {Object} props - Component props
 * @param {string} props.searchTerm - Current search term
 * @param {Function} props.onSearchChange - Callback for search term changes
 * @param {Array} props.searchResults - List of search results
 * @param {string|null} props.searchError - Error message to display
 * @param {boolean} props.isSearching - Whether a search is currently in progress
 * @param {boolean} [props.isSearchSlow] - The search has been running for a while
 * @param {Function} [props.onRetrySearch] - Starts the search again
 * @param {Function} props.onSelectSong - Callback when a song is confirmed (opens snippet selector)
 * @param {Function} props.onSelectionChange - Callback when selection changes (for auto-submit on timer expiry)
 * @param {Function} props.onShowPrompt - Callback to show the prompt modal
 * @param {boolean} props.showPromptModal - Whether the prompt modal is visible
 * @returns {JSX.Element} Rendered component
 */
export function SongSelectionView({
  searchTerm,
  onSearchChange,
  searchResults,
  searchError,
  isSearching,
  isSearchSlow = false,
  onRetrySearch,
  onSelectSong,
  onSelectionChange,
  onShowPrompt,
  showPromptModal
}) {
  const [selectedTrack, setSelectedTrack] = useState(null);
  // New results render at low priority: mounting a page of rows must never
  // hold up the next keystroke.
  const shownResults = useDeferredValue(searchResults);
  // Nothing typed yet: a hint. Still searching, or the error box already
  // says why there are no songs: nothing.
  const emptyText = !searchTerm?.trim()
    ? "Search for a song to play."
    : isSearching || searchError
      ? null
      : undefined;

  /**
   * Handles selecting a track from the search results
   * @param {Object} track - The selected track object
   */
  const handleSelectTrack = useCallback((track) => {
    setSelectedTrack(track);
    // Notify parent of selection change for auto-submit on timer expiry
    onSelectionChange?.(track);
  }, [onSelectionChange]);

  /**
   * Handles confirming the selected track and submitting it
   * @param {Object} track - The track to submit
   */
  const handleConfirmTrack = useCallback((track) => {
    onSelectSong(track);
  }, [onSelectSong]);

  return (
    <div
      data-vital="song-select"
      className={`song-selection-view flex flex-col h-screen w-full ${
        showPromptModal ? "blur-sm" : ""
      }`}
    >
      <div className="w-full">
        <div className="max-w-[100vw] sm:max-w-xl lg:max-w-2xl mx-auto px-4">
          {/* Top margin clears the fixed round timer pill (it ends 60px from the top). */}
          <div className="flex justify-center mt-16 lg:mt-32 mb-4">
            <SearchBar
              value={searchTerm}
              onChange={onSearchChange}
              placeholder="What do you want to play?"
              busy={Boolean(isSearching && searchTerm && !isSearchSlow)}
              busyLabel="Searching for songs..."
            />
          </div>
        </div>
      </div>

      <ScrollFade className="flex-1 min-h-0">
        <div className="max-w-[100vw] sm:max-w-xl lg:max-w-2xl mx-auto px-4">
          {searchError && (
            <div className="mb-4 p-4 bg-red-500 bg-opacity-20 border border-red-500 rounded-lg text-red-200 text-center">
              <p className="font-medium">{searchError}</p>
            </div>
          )}
          {/* Only a search that is taking a while gets its own row (with Retry);
              a young one shows its spinner inside the search bar. */}
          {isSearching && searchTerm && isSearchSlow && (
            <div role="status" className="mb-4 p-4 text-center text-gray-300">
              <p>Still searching...</p>
              {onRetrySearch && (
                <button
                  type="button"
                  onClick={onRetrySearch}
                  className="mt-3 rounded-full border border-white/20 px-4 py-1.5 text-sm text-white hover:bg-white/10 active:scale-95 transition-colors"
                >
                  Retry
                </button>
              )}
            </div>
          )}
          <SongList
            tracks={shownResults}
            emptyText={emptyText}
            selectedTrack={selectedTrack}
            onSelectTrack={handleSelectTrack}
            onConfirmTrack={handleConfirmTrack} 
          />
        </div>
      </ScrollFade>

      <div className="w-full">
        <div className="max-w-[100vw] sm:max-w-xl lg:max-w-2xl mx-auto px-4 pt-4 pb-6">
          <button
            onClick={onShowPrompt}
            className="green-btn w-full py-3 rounded-md text-black font-semibold cursor-pointer"
          >
            View Prompt
          </button>
        </div>
      </div>
    </div>
  );
} 
/**
 * The song selection screen with its own search state. Memoized: the round
 * re-renders every second for its countdown, and with stable props this
 * screen (and its result list) is left alone; a keystroke re-renders only it.
 *
 * @param {Object} props
 * @param {Function} props.onSelectSong - A song was confirmed (opens the snippet selector)
 * @param {Function} [props.onSelectionChange] - Selection changed (for auto-submit on timer expiry)
 * @param {Function} props.onShowPrompt - Show the prompt modal
 * @param {boolean} props.showPromptModal - Whether the prompt modal is visible
 * @param {Function} [props.onNoResults] - A 3+ character search came back empty
 * @param {Function} [props.onSearchFailed] - The search failed, with its reason
 */
function SongSelection({ onNoResults, onSearchFailed, ...props }) {
  const search = useSongSearch({ onNoResults, onFailed: onSearchFailed });
  return <SongSelectionView {...search} {...props} />;
}

export default memo(SongSelection);
