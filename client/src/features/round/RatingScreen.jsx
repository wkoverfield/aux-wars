import React, { useState, useRef, useEffect } from 'react';
import record from '../../assets/record.svg';
import SearchBar from '../../components/SearchBar';
import { YouTubePlayerWithRef } from '../../components/YouTubePlayer';
import { useToast } from '../../contexts/ToastContext';

/**
 * RatingScreen component provides an interface for rating songs during the game.
 * Includes song playback, album art display, and a 5-star rating system.
 * 
 * @param {Object} props - Component props
 * @param {string} props.currentPrompt - The current game prompt
 * @param {Object} props.songToRate - The song object to be rated
 * @param {Function} props.onSubmitRating - Callback when rating is submitted
 * @param {number} props.currentIndex - Current song index in the rating sequence
 * @param {number} props.totalSongs - Total number of songs to rate
 * @returns {JSX.Element} Rendered component
 */
const RatingScreen = ({
  currentPrompt,
  songToRate,
  onSubmitRating,
  currentIndex,
  totalSongs
}) => {
  const [selectedRating, setSelectedRating] = useState(-1);
  const [snippetProgress, setSnippetProgress] = useState(0); // 0-1 progress within snippet
  const { showToast } = useToast();
  const playerRef = useRef(null);
  const lastValidTimeRef = useRef(null); // Track last valid position for restore

  // Extract YouTube video ID from preview URL
  const getYouTubeVideoId = (url) => {
    if (!url) return null;
    const match = url.match(/embed\/([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
  };
  
  const videoId = getYouTubeVideoId(songToRate?.previewUrl);
  
  // Extract snippet times if available
  const startTime = songToRate?.snippet?.startTime || 0;
  const endTime = songToRate?.snippet?.endTime || 0;

  // Snippet duration for display
  const snippetDuration = endTime - startTime;
  const hasSnippet = songToRate?.snippet && endTime > 0;

  // Format time as M:SS
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Monitor playback position, enforce snippet bounds, and update progress
  useEffect(() => {
    // Skip if no snippet (full song mode) or no valid end time
    if (!hasSnippet) return;

    // Initialize last valid time to start
    lastValidTimeRef.current = startTime;

    const interval = setInterval(() => {
      if (playerRef.current?.getCurrentTime) {
        const currentTime = playerRef.current.getCurrentTime();

        // Check if within valid bounds
        const isWithinBounds = currentTime >= startTime - 0.5 && currentTime <= endTime + 0.5;

        if (isWithinBounds) {
          // Update progress and save this as last valid position
          const progress = Math.max(0, Math.min(1, (currentTime - startTime) / snippetDuration));
          setSnippetProgress(progress);
          lastValidTimeRef.current = currentTime;
        } else {
          // Outside bounds - restore to last valid position (or start if near end)
          const restoreTime = currentTime > endTime
            ? startTime // If past end, loop to start (natural behavior)
            : lastValidTimeRef.current || startTime; // If before start, go back to where they were

          playerRef.current.seekTo(restoreTime);
          const progress = Math.max(0, Math.min(1, (restoreTime - startTime) / snippetDuration));
          setSnippetProgress(progress);
        }
      }
    }, 200); // Faster updates for smoother progress bar

    return () => clearInterval(interval);
  }, [startTime, endTime, snippetDuration, hasSnippet]);

  /**
   * Handles clicking a rating record
   * @param {number} index - The index of the selected rating (0-4)
   */
  const handleRatingClick = (index) => {
    setSelectedRating(index);
  };

  /**
   * Handles submitting the rating
   * Validates that a rating has been selected before submitting
   */
  const handleSubmit = () => {
    if (selectedRating >= 0) {
      // Add 1 to the index to get rating from 1-5 instead of 0-4
      onSubmitRating(songToRate.songId, selectedRating + 1);
    } else {
      showToast("Please select a rating before submitting", "warning");
    }
  };

  return (
    <div className="flex flex-col items-center w-full min-h-screen box-border px-2 pt-4 pb-24 sm:pt-8 sm:pb-32 bg-transparent">
      {/* Prompt at the top */}
      <div className="w-full mb-2 sm:mb-4 overflow-x-auto">
        <SearchBar value={currentPrompt || ''} readOnly onChange={() => {}} />
      </div>
      
      {/* Main content vertically centered */}
      <div className="flex flex-col items-center flex-grow justify-center w-full max-w-md mx-auto">
        {/* Song counter */}
        <div className="mb-2 sm:mb-4 text-white text-center">
          <p>Rating Song {currentIndex + 1} of {totalSongs}</p>
        </div>
        {/* Removed redundant album cover - YouTube player shows thumbnail */}

        {/* YouTube Player */}
        {videoId && (
          <div className="mb-2 w-full max-w-md flex justify-center" style={{ height: '260px' }}>
            <YouTubePlayerWithRef
              ref={playerRef}
              videoId={videoId}
              autoplay={false}
              startTime={startTime}
              endTime={endTime}
            />
          </div>
        )}

        {/* Snippet Progress Indicator */}
        {hasSnippet && (
          <div className="w-full max-w-md mb-4 px-2">
            <div className="flex items-center gap-3">
              <span className="text-xs text-gray-400 min-w-[40px]">
                {formatTime(snippetProgress * snippetDuration)}
              </span>
              <div className="flex-1 h-1.5 bg-[#333] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#1db954] rounded-full transition-all duration-200"
                  style={{ width: `${snippetProgress * 100}%` }}
                />
              </div>
              <span className="text-xs text-gray-400 min-w-[40px] text-right">
                {formatTime(snippetDuration)}
              </span>
            </div>
            <p className="text-xs text-gray-500 text-center mt-1">
              Snippet: {formatTime(startTime)} - {formatTime(endTime)}
            </p>
          </div>
        )}

        {/* Track name and artist name */}
        <div className="flex flex-col justify-center items-center mb-6">
          <p className="text-2xl sm:text-3xl font-semibold text-white text-center max-w-[95vw] truncate">{songToRate.name}</p>
          <p className="text-base sm:text-lg text-gray-300 text-center max-w-[95vw] truncate">
            {songToRate.artist}
          </p>
          <p className="text-xs text-gray-400 mt-1 text-center">
            Submitted by: {songToRate.player?.name || 'Unknown Player'}
          </p>
        </div>

        {/* Rating system */}
        <div className="flex flex-row justify-center items-center mb-8">
          {[...Array(5)].map((_, index) => (
            <img
              key={index}
              src={record}
              alt={`rate this song ${index + 1} records`}
              className={`w-[48px] sm:w-[56px] m-2 sm:m-2.5 cursor-pointer transition-all duration-300 hover:scale-110 ${
                index <= selectedRating ? "opacity-100" : "opacity-50"
              }`}
              onClick={() => handleRatingClick(index)}
            />
          ))}
        </div>
      </div>
      {/* Submit button fixed at the bottom */}
      <div className="fixed left-0 right-0 bottom-0 flex justify-center pb-4 bg-gradient-to-t from-black/80 to-transparent z-20">
        <button 
          className={`bg-[#68d570] text-black font-bold w-full max-w-xs h-[52px] rounded-full cursor-pointer transition-all hover:scale-105 hover:bg-[#7de884] ${
            selectedRating < 0 ? 'opacity-50 cursor-not-allowed' : ''
          }`}
          onClick={handleSubmit}
          disabled={selectedRating < 0}
        >
          Submit
        </button>
      </div>
    </div>
  );
};

export default RatingScreen; 