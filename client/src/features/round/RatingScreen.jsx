import React, { useState, useRef, useEffect } from 'react';
import { useMutation } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import record from '../../assets/record.svg';
import SearchBar from '../../components/SearchBar';
import TrackPlayer from '../../components/TrackPlayer';
import { useToast } from '../../contexts/ToastContext';
import { captureGameEvent } from '../../services/analytics';

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
  onAutoSubmit
}) => {
  const [selectedRating, setSelectedRating] = useState(-1);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [progress, setProgress] = useState(0); // 0-1 playback progress
  const [playbackTime, setPlaybackTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const { showToast } = useToast();
  const logEvent = useMutation(api.analytics.logEvent);
  const clipStartRef = useRef(Date.now());
  const playerRef = useRef(null);

  const previewUrl = songToRate?.previewUrl;
  const videoId = songToRate?.videoId;
  const snippet = songToRate?.snippet;
  const startTime = snippet?.startTime ?? 0;
  const endTime = snippet?.endTime ?? 0;
  const hasPlayable = !!(previewUrl || videoId);

  // Format time as M:SS
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  /**
   * Handles clicking a rating record
   * @param {number} index - The index of the selected rating (0-4)
   */
  const handleRatingClick = (index) => {
    setSelectedRating(index);
  };

  const handleTogglePlayback = () => {
    playerRef.current?.toggle?.();
  };

  const handleSeek = (seconds) => {
    const next = Math.max(0, Math.min(seconds, duration || seconds));
    playerRef.current?.seekTo?.(next);
    setPlaybackTime(next);
    setProgress(duration > 0 ? Math.min(1, next / duration) : 0);
  };

  /**
   * Handles submitting the rating
   * Validates that a rating has been selected before submitting
   */
  const handleSubmit = () => {
    if (selectedRating >= 0) {
      setHasSubmitted(true);
      // How long they listened before voting (informs clip length / pacing).
      const listenMs = Date.now() - clipStartRef.current;
      logEvent({ eventType: "vote_listen", metadata: { value: listenMs } });
      captureGameEvent("vote_listen", {
        listen_ms: listenMs,
        rating_value: selectedRating + 1,
        source: videoId ? "youtube" : "preview",
        has_clip_window: Boolean(snippet),
      });
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
    setProgress(0);
    setPlaybackTime(0);
    setIsPlaying(false);
    setDuration(0);
    clipStartRef.current = Date.now(); // reset listen timer per song
  }, [songToRate?.songId]);

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

        {/* Album art — for preview tracks; YouTube tracks show the video instead */}
        {songToRate?.albumCover && !videoId && (
          <div className="mb-4 flex justify-center">
            <img
              src={songToRate.albumCover}
              alt={`${songToRate.name} album art`}
              className="w-48 h-48 sm:w-56 sm:h-56 rounded-lg object-cover shadow-lg"
            />
          </div>
        )}

        {/* Player — YouTube window (aspect-video) or audio preview (button) */}
        {hasPlayable && (
          <div className="w-full mb-4 flex justify-center">
            <TrackPlayer
              ref={playerRef}
              videoId={videoId}
              src={previewUrl}
              startTime={startTime}
              endTime={endTime}
              autoPlay
              loop
              showControls={!videoId}
              onReady={(d) => setDuration(d)}
              onTimeUpdate={(t) => {
                setPlaybackTime(t);
                setProgress(duration > 0 ? Math.min(1, t / duration) : 0);
              }}
              onPlayingChange={setIsPlaying}
            />
          </div>
        )}

        {/* Playback controls */}
        {hasPlayable && duration > 0 && (
          <div className="w-full max-w-md mb-5 px-1">
            <div className="flex items-center gap-3 rounded-[8px] border border-white/10 bg-[#111]/90 px-3 py-3">
              <button
                type="button"
                onClick={handleTogglePlayback}
                aria-label={isPlaying ? 'Pause clip' : 'Play clip'}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#68d570] text-black transition hover:bg-[#7de884] active:scale-95"
              >
                {isPlaying ? (
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <rect x="6" y="5" width="4" height="14" rx="1" />
                    <rect x="14" y="5" width="4" height="14" rx="1" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M8 5.14v13.72a1 1 0 0 0 1.54.84l10.29-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14z" />
                  </svg>
                )}
              </button>

              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
                    Clip
                  </span>
                  <span className="text-xs tabular-nums text-white/70">
                    {formatTime(playbackTime)}
                  </span>
                </div>
                <input
                  type="range"
                  aria-label="Clip playback position"
                  min={0}
                  max={Math.max(0, Math.floor(duration))}
                  step={0.25}
                  value={Math.min(playbackTime, duration)}
                  onChange={(e) => handleSeek(Number(e.target.value))}
                  className="slider clip-playback-slider h-3 w-full"
                  style={{ '--progress': `${progress * 100}%` }}
                />
              </div>

              <span className="flex h-8 min-w-[48px] items-center justify-center rounded-md bg-white/[0.07] px-2 text-xs tabular-nums text-white/75">
                {formatTime(duration)}
              </span>
            </div>
          </div>
        )}

        {/* Track name and artist name */}
        <div className="flex flex-col justify-center items-center mb-6">
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
        )}

        {/* Spectator message - shown when viewing own song */}
        {spectatorMode && (
          <div className="text-center mb-8">
            <p className="text-xl text-green-400 font-semibold">This is your song!</p>
            <p className="text-gray-400">Waiting for others to rate...</p>
          </div>
        )}
      </div>

      {/* Submit button fixed at the bottom - hidden in spectator mode */}
      {!spectatorMode && (
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
      )}
    </div>
  );
};

export default RatingScreen;
