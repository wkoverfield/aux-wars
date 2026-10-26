import { useState, useRef, useEffect } from 'react';
import { useMutation } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import record from '../../assets/record.svg';
import SearchBar from '../../components/SearchBar';
import ScrollFade from '../../components/ScrollFade';
import ClipPlayer from './ClipPlayer';
import { useToast } from '../../contexts/ToastContext';
import { fallBackToOriginal, largeCoverArt } from "../../utils/coverArt";

/**
 * RatingScreen component provides an interface for rating songs during the game.
 * Plays the submitted clip — a chosen window of a full YouTube song, or an
 * iTunes/Deezer 30s preview (TrackPlayer picks per source) — shows album art (or
 * the video), and a 5-star rating system. In spectator mode, shows the player
 * but hides voting controls (for the player's own song).
 *
 * @param {Object} props - Component props
 * @param {string} props.currentPrompt - The current game prompt
 * @param {Object} props.songToRate - The song object to be rated
 * @param {Function} props.onSubmitRating - Callback when rating is submitted
 * @param {number} props.currentIndex - Current song index in the rating sequence
 * @param {number} props.totalSongs - Total number of songs to rate
 * @param {boolean} props.anonymousMode - Whether to hide who submitted the song
 * @param {boolean} props.spectatorMode - If true, show player but hide rating UI (viewing own song)
 * @param {Function} props.onAutoSubmit - Optional callback for auto-submit on timeout (called with rating)
 * @param {boolean} props.screenAttached - A big screen in the room plays the clip
 * @param {boolean} props.playOnPhone - Play the clip here too (only matters with a screen attached)
 * @param {Function} props.onTogglePlayOnPhone - Turns playing on this phone on or off
 * @returns {JSX.Element} Rendered component
 */
const RatingScreen = ({
  currentPrompt,
  songToRate,
  onSubmitRating,
  currentIndex,
  totalSongs,
  anonymousMode = false,
  spectatorMode = false,
  onAutoSubmit,
  screenAttached = false,
  playOnPhone = false,
  onTogglePlayOnPhone,
}) => {
  const [selectedRating, setSelectedRating] = useState(-1);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const { showToast } = useToast();
  const logEvent = useMutation(api.analytics.logEvent);
  const clipStartRef = useRef(Date.now());

  const previewUrl = songToRate?.previewUrl;
  const videoId = songToRate?.videoId;
  const snippet = songToRate?.snippet;
  const startTime = snippet?.startTime ?? 0;
  const endTime = snippet?.endTime ?? 0;
  // The big screen plays the clip; this phone stays quiet unless asked.
  const silent = screenAttached && !playOnPhone;

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
    if (hasSubmitted) return;
    if (selectedRating >= 0) {
      setHasSubmitted(true);
      // Mark the ref now, not in an effect: the parent may swap this screen
      // out in the same render, and the unmount auto-submit must not send
      // this rating a second time.
      prevSongRef.current = { ...prevSongRef.current, submitted: true };
      // How long they listened before voting (informs clip length / pacing).
      const listenMs = Date.now() - clipStartRef.current;
      logEvent({ eventType: "vote_listen", metadata: { value: listenMs } });
      // Add 1 to the index to get rating from 1-5 instead of 0-4
      onSubmitRating(songToRate.songId, selectedRating + 1);
    } else {
      showToast("Please select a rating before submitting", "warning");
    }
  };

  // Track previous song state for auto-submit on song change
  const prevSongRef = useRef({ songId: null, rating: -1, submitted: false });
  // Ref for onAutoSubmit to avoid dependency issues (prevents premature cleanup triggers)
  const onAutoSubmitRef = useRef(onAutoSubmit);
  onAutoSubmitRef.current = onAutoSubmit;

  // Update the ref whenever state changes (so we have latest values when song changes)
  useEffect(() => {
    prevSongRef.current = {
      songId: songToRate?.songId,
      rating: selectedRating,
      submitted: hasSubmitted
    };
  }, [songToRate?.songId, selectedRating, hasSubmitted]);

  // Auto-submit pending rating when song changes (server timeout advances to next song)
  useEffect(() => {
    return () => {
      // Cleanup runs when songId changes or component unmounts
      const prev = prevSongRef.current;
      const autoSubmit = onAutoSubmitRef.current;
      if (prev.songId && prev.rating >= 0 && !prev.submitted && autoSubmit) {
        autoSubmit(prev.songId, prev.rating + 1); // +1 to convert 0-4 to 1-5
      }
    };
  }, [songToRate?.songId]); // Only depend on songId - use refs for callback

  // Reset state when song changes
  useEffect(() => {
    setSelectedRating(-1);
    setHasSubmitted(false);
    clipStartRef.current = Date.now(); // reset listen timer per song
  }, [songToRate?.songId]);

  return (
    <div data-vital="rating" className="h-[100svh] w-full flex flex-col">
    <ScrollFade className="flex-1 min-h-0 w-full" contentClassName="min-h-full flex flex-col items-center justify-center w-full py-4 px-2">
        {/* Prompt at the top */}
        <div className="w-full mb-2 sm:mb-4 overflow-x-auto">
          <SearchBar value={currentPrompt || ''} readOnly onChange={() => {}} />
        </div>

        {/* Main content */}
        <div className="flex flex-col items-center w-full max-w-md mx-auto">
        {/* Song counter */}
        <div className="mb-2 sm:mb-4 text-white text-center">
          <p>Rating Song {currentIndex + 1} of {totalSongs}</p>
        </div>

        {/* Album art — for preview tracks; YouTube tracks show the video instead.
            Sizes off viewport HEIGHT so it shrinks on short/landscape screens. */}
        {songToRate?.albumCover && (!videoId || silent) && (
          <div className="mb-3 flex justify-center">
            <img
              src={largeCoverArt(songToRate.albumCover)}
              onError={fallBackToOriginal(songToRate.albumCover)}
              alt={`${songToRate.name} album art`}
              className="w-[min(13rem,30vh)] h-[min(13rem,30vh)] rounded-lg object-cover shadow-lg"
            />
          </div>
        )}

        {/* Player and its scrubber: its own component, so playback ticks never
            re-render this screen and a rating tap never re-renders the player. */}
        {!silent && (
          <ClipPlayer
            key={songToRate?.songId}
            videoId={videoId}
            previewUrl={previewUrl}
            startTime={startTime}
            endTime={endTime}
          />
        )}

        {/* Quiet on purpose: the screen is where the song plays. */}
        {screenAttached && (
          <button
            type="button"
            data-vital="phone-audio"
            onClick={onTogglePlayOnPhone}
            className="mb-3 flex items-center gap-1.5 text-xs text-white/50 hover:text-white transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4" aria-hidden="true">
              {playOnPhone ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 9.75 19.5 12m0 0 2.25 2.25M19.5 12l2.25-2.25M19.5 12l-2.25 2.25m-10.5-6 4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z" />
              )}
            </svg>
            {playOnPhone ? "Mute this phone" : "Play on this phone"}
          </button>
        )}

        {/* Track name and artist name */}
        <div className="flex flex-col justify-center items-center mb-3">
          <p className="text-2xl sm:text-3xl font-semibold text-white text-center max-w-[95vw] truncate">{songToRate.name}</p>
          <p className="text-base sm:text-lg text-gray-300 text-center max-w-[95vw] truncate">
            {songToRate.artist}
          </p>
          <p className="text-xs text-gray-400 mt-1 text-center">
            Submitted by: <span>{anonymousMode ? '???' : (songToRate.player?.name || 'Unknown Player')}</span>
          </p>
        </div>

        {/* Rating system - hidden in spectator mode */}
        {!spectatorMode && (
          <div className="flex flex-row justify-center items-center mb-4">
            {[...Array(5)].map((_, index) => (
              <img
                key={index}
                data-vital="record"
                src={record}
                alt={`rate this song ${index + 1} records`}
                className={`w-[48px] sm:w-[56px] m-2 sm:m-2.5 cursor-pointer transition-opacity duration-100 active:scale-95 ${
                  index <= selectedRating ? "opacity-100" : "opacity-50"
                }`}
                onClick={() => handleRatingClick(index)}
              />
            ))}
          </div>
        )}

        {/* Spectator message - shown when viewing own song */}
        {spectatorMode && (
          <div className="text-center mb-8">
            <p className="text-xl text-green-400 font-semibold">This is your song!</p>
            <p className="text-gray-400">Waiting for others to rate...</p>
          </div>
        )}
        </div>
    </ScrollFade>

      {/* Submit — pinned footer: always visible, content scrolls above it.
          Lives outside the scroll area so a primary action is never below the fold. */}
      {!spectatorMode && (
        <div className="shrink-0 w-full px-2 pt-2 pb-4">
          <div className="w-full max-w-xs mx-auto">
            <button
              data-vital="submit"
              className={`bg-[#68d570] text-black font-bold w-full h-[52px] rounded-full cursor-pointer transition-all hover:scale-105 hover:bg-[#7de884] ${
                selectedRating < 0 || hasSubmitted ? 'opacity-50 cursor-not-allowed' : ''
              }`}
              onClick={handleSubmit}
              disabled={selectedRating < 0 || hasSubmitted}
            >
              Submit
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default RatingScreen;
