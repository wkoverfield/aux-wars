import React, { useState, useEffect, useRef } from 'react';
import { YouTubePlayerWithRef } from './YouTubePlayer';
import { motion } from 'framer-motion';

/**
 * SnippetSelector component allows users to select a portion of a song to showcase
 * Provides visual timeline controls and preview functionality
 */
export default function SnippetSelector({ track, onConfirm, onCancel }) {
  const [startTime, setStartTime] = useState(30); // Default to 30 seconds
  const [endTime, setEndTime] = useState(60); // Default 30-second snippet
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const playerRef = useRef(null);
  const intervalRef = useRef(null);

  // Extract video ID from preview URL
  const getVideoId = (url) => {
    if (!url) return null;
    const match = url.match(/embed\/([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
  };

  const videoId = getVideoId(track?.preview_url);

  // Format time in MM:SS
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Quick preset options
  const presets = [
    { label: "First 30s", start: 0, end: 30 },
    { label: "Best Part", start: 45, end: 75 },
    { label: "Chorus", start: 60, end: 90 },
  ];

  // Handle preset selection
  const selectPreset = (preset) => {
    setStartTime(preset.start);
    setEndTime(preset.end);
  };

  // Preview the selected snippet
  const previewSnippet = () => {
    if (playerRef.current && playerRef.current.player) {
      playerRef.current.player.seekTo(startTime);
      playerRef.current.player.playVideo();
      setIsPlaying(true);
    }
  };

  // Stop preview
  const stopPreview = () => {
    if (playerRef.current && playerRef.current.player) {
      playerRef.current.player.pauseVideo();
      setIsPlaying(false);
    }
  };

  // Update current time while playing
  useEffect(() => {
    if (isPlaying && playerRef.current && playerRef.current.player) {
      intervalRef.current = setInterval(() => {
        const time = playerRef.current.player.getCurrentTime();
        setCurrentTime(time);
        
        // Stop at end time
        if (time >= endTime) {
          playerRef.current.player.seekTo(startTime);
        }
      }, 100);
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isPlaying, endTime, startTime]);

  // Validate and adjust times
  const handleStartChange = (value) => {
    const newStart = Math.max(0, Math.min(value, duration - 15));
    setStartTime(newStart);
    if (endTime - newStart < 15) {
      setEndTime(Math.min(newStart + 30, duration));
    }
  };

  const handleEndChange = (value) => {
    const newEnd = Math.min(value, duration);
    if (newEnd - startTime >= 15) {
      setEndTime(newEnd);
    }
  };

  // Confirm selection
  const handleConfirm = () => {
    onConfirm({
      ...track,
      snippet: {
        startTime,
        endTime
      }
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center p-4"
    >
      <div className="bg-gray-900 rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <h2 className="text-2xl font-bold text-white mb-4">Choose Your Snippet</h2>
        
        {/* Song info */}
        <div className="mb-4">
          <p className="text-lg text-white font-semibold">{track.name}</p>
          <p className="text-gray-400">{track.artists[0]?.name}</p>
        </div>

        {/* YouTube Player */}
        <div className="mb-6 aspect-video bg-black rounded-lg overflow-hidden">
          <YouTubePlayerWithRef
            ref={playerRef}
            videoId={videoId}
            autoplay={false}
            startTime={startTime}
            endTime={endTime}
            onReady={(event) => {
              const player = event.target;
              setDuration(player.getDuration());
            }}
          />
        </div>

        {/* Timeline Controls */}
        <div className="mb-6">
          <div className="flex justify-between text-sm text-gray-400 mb-2">
            <span>Start: {formatTime(startTime)}</span>
            <span>Duration: {formatTime(endTime - startTime)}</span>
            <span>End: {formatTime(endTime)}</span>
          </div>

          {/* Start time slider */}
          <div className="mb-4">
            <label className="block text-sm text-gray-400 mb-1">Start Time</label>
            <input
              type="range"
              min="0"
              max={duration}
              value={startTime}
              onChange={(e) => handleStartChange(Number(e.target.value))}
              className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
              style={{
                background: `linear-gradient(to right, #68d570 0%, #68d570 ${(startTime / duration) * 100}%, #374151 ${(startTime / duration) * 100}%, #374151 100%)`
              }}
            />
          </div>

          {/* End time slider */}
          <div className="mb-4">
            <label className="block text-sm text-gray-400 mb-1">End Time</label>
            <input
              type="range"
              min={startTime + 15}
              max={duration}
              value={endTime}
              onChange={(e) => handleEndChange(Number(e.target.value))}
              className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer slider"
              style={{
                background: `linear-gradient(to right, #68d570 0%, #68d570 ${(endTime / duration) * 100}%, #374151 ${(endTime / duration) * 100}%, #374151 100%)`
              }}
            />
          </div>

          {/* Visual timeline */}
          <div className="relative h-16 bg-gray-800 rounded-lg overflow-hidden">
            <div 
              className="absolute top-0 bottom-0 bg-green-500 bg-opacity-30"
              style={{
                left: `${(startTime / duration) * 100}%`,
                width: `${((endTime - startTime) / duration) * 100}%`
              }}
            />
            {isPlaying && (
              <div 
                className="absolute top-0 bottom-0 w-0.5 bg-white"
                style={{
                  left: `${(currentTime / duration) * 100}%`
                }}
              />
            )}
          </div>
        </div>

        {/* Quick Presets */}
        <div className="mb-6">
          <p className="text-sm text-gray-400 mb-2">Quick Presets:</p>
          <div className="flex gap-2">
            {presets.map((preset) => (
              <button
                key={preset.label}
                onClick={() => selectPreset(preset)}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-md text-sm transition-colors"
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-4">
          <button
            onClick={isPlaying ? stopPreview : previewSnippet}
            className="flex-1 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-md font-semibold transition-colors"
          >
            {isPlaying ? 'Stop Preview' : 'Preview Snippet'}
          </button>
          
          <button
            onClick={handleConfirm}
            className="flex-1 py-3 bg-green-600 hover:bg-green-500 text-black rounded-md font-semibold transition-colors"
          >
            Confirm Selection
          </button>
          
          <button
            onClick={onCancel}
            className="px-6 py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-md transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </motion.div>
  );
}