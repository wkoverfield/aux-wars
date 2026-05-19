import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import SearchBar from "../../components/SearchBar";
import SongList from "../../components/SongList";

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
 * @param {Function} props.onSelectSong - Callback when a song is confirmed (opens snippet selector)
 * @param {Function} props.onSelectionChange - Callback when selection changes (for auto-submit on timer expiry)
 * @param {Function} props.onShowPrompt - Callback to show the prompt modal
 * @param {boolean} props.showPromptModal - Whether the prompt modal is visible
 * @returns {JSX.Element} Rendered component
 */
export default function SongSelection({
  searchTerm,
  onSearchChange,
  searchResults,
  searchError,
  isSearching,
  onSelectSong,
  onSelectionChange,
  onShowPrompt,
  showPromptModal
}) {
  const [selectedTrack, setSelectedTrack] = useState(null);

  /**
   * Handles selecting a track from the search results
   * @param {Object} track - The selected track object
   */
  const handleSelectTrack = (track) => {
    setSelectedTrack(track);
    // Notify parent of selection change for auto-submit on timer expiry
    onSelectionChange?.(track);
  };

  /**
   * Handles confirming the selected track and submitting it
   * @param {Object} track - The track to submit
   */
  const handleConfirmTrack = (track) => {
    onSelectSong(track);
  };

  return (
    <div
      className={`song-selection-view flex flex-col h-screen w-full ${
        showPromptModal ? "blur-sm" : ""
      }`}
    >
      <div className="w-full">
        <div className="max-w-[100vw] sm:max-w-xl lg:max-w-2xl mx-auto px-4">
          <div className="flex justify-center mt-8 sm:mt-16 lg:mt-32 mb-4">
            <SearchBar
              value={searchTerm}
              onChange={onSearchChange}
              placeholder="What do you want to play?"
            />
          </div>
        </div>
      </div>

      <div className="overflow-y-auto flex-1">
        <div className="max-w-[100vw] sm:max-w-xl lg:max-w-2xl mx-auto px-4">
          {searchError && (
            <div className="mb-4 p-4 bg-red-500 bg-opacity-20 border border-red-500 rounded-lg text-red-200 text-center">
              <p className="font-medium">{searchError}</p>
            </div>
          )}
          <AnimatePresence>
            {isSearching && searchTerm && (
              <motion.div 
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.3 }}
                className="mb-4 p-4 text-center"
              >
                <div className="flex items-center justify-center gap-3 text-gray-300">
                  <motion.div 
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    className="rounded-full h-6 w-6 border-2 border-green-500 border-t-transparent"
                  />
                  <motion.span
                    animate={{ opacity: [0.7, 1, 0.7] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                  >
                    Searching for songs...
                  </motion.span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <SongList 
            tracks={searchResults} 
            selectedTrack={selectedTrack}
            onSelectTrack={handleSelectTrack}
            onConfirmTrack={handleConfirmTrack} 
          />
        </div>
      </div>

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