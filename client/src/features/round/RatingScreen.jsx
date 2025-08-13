import React, { useState } from 'react';
import record from '../../assets/record.svg';
import SearchBar from '../../components/SearchBar';
import YouTubePlayer from '../../components/YouTubePlayer';

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
      alert("Please select a rating before submitting");
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
          <div className="mb-4 sm:mb-6 w-full max-w-md flex justify-center" style={{ height: '260px' }}>
            <YouTubePlayer
              videoId={videoId}
              autoplay={false}
              startTime={startTime}
              endTime={endTime}
              loop={true}
            />
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