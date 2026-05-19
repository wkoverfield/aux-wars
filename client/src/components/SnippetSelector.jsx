import React, { useState, useEffect, useRef, useImperativeHandle } from 'react';
import { YouTubePlayerWithRef } from './YouTubePlayer';
import { motion } from 'framer-motion';

/**
 * SnippetSelector component allows users to select a portion of a song to showcase
 * Provides visual timeline controls and preview functionality
 *
 * @param {Object} ref - React 19 ref prop for exposing getCurrentSelection() to parent
 */
export default function SnippetSelector({ ref, track, snippetDuration = 30, onConfirm, onCancel }) {
  // 0 = full song, otherwise use the provided duration
  const SNIPPET_DURATION = snippetDuration ?? 30;
  const isFullSong = snippetDuration === 0;
  const [startTime, setStartTime] = useState(30); // Default to 30 seconds
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [hoverTime, setHoverTime] = useState(0);
  const playerRef = useRef(null);
  const intervalRef = useRef(null);
  const waveformRef = useRef(null);
  const updateTimerRef = useRef(null);
  const hasAutoConfirmedRef = useRef(false); // Guard against repeated auto-confirm calls

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

  // Calculate end time based on start time
  const endTime = Math.min(startTime + SNIPPET_DURATION, duration);

  // Expose getCurrentSelection method to parent for auto-submit on timer expiry
  useImperativeHandle(ref, () => ({
    getCurrentSelection: () => ({
      ...track,
      snippet: isFullSong ? null : { startTime, endTime }
    })
  }), [track, isFullSong, startTime, endTime]);

  // Keyboard controls
  useEffect(() => {
    const handleKeyPress = (e) => {
      if (!duration) return;
      
      const maxStart = Math.max(0, duration - SNIPPET_DURATION);
      
      switch(e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          const newStartLeft = Math.max(0, startTime - 1);
          setStartTime(newStartLeft);
          updateVideoPreview(newStartLeft);
          break;
        case 'ArrowRight':
          e.preventDefault();
          const newStartRight = Math.min(maxStart, startTime + 1);
          setStartTime(newStartRight);
          updateVideoPreview(newStartRight);
          break;
        case ' ':
          e.preventDefault();
          if (isPlaying) {
            stopPreview();
          } else {
            previewSnippet();
          }
          break;
        case 'Enter':
          e.preventDefault();
          handleConfirm();
          break;
        case 'Escape':
          e.preventDefault();
          onCancel();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [startTime, duration, isPlaying]);

  // Global mouse event handling for dragging
  useEffect(() => {
    if (isDragging) {
      const handleMouseMove = (e) => {
        if (waveformRef.current) {
          const rect = waveformRef.current.getBoundingClientRect();
          const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
          const percentage = x / rect.width;
          const maxStart = Math.max(0, duration - SNIPPET_DURATION);
          const newStart = Math.min(Math.max(0, percentage * duration - SNIPPET_DURATION / 2), maxStart);
          setStartTime(newStart);
        }
      };

      const handleMouseUp = () => {
        setIsDragging(false);
        updateVideoPreview(startTime);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);

      return () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, duration, startTime]);

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

  // Handle waveform interaction
  const handleWaveformClick = (e) => {
    const rect = waveformRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    const maxStart = Math.max(0, duration - SNIPPET_DURATION);
    const newStart = Math.min(percentage * duration, maxStart);
    setStartTime(newStart);
    updateVideoPreview(newStart);
  };

  const handleWaveformMouseMove = (e) => {
    if (!waveformRef.current) return;
    const rect = waveformRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const percentage = x / rect.width;
    const time = percentage * duration;
    setHoverTime(time);
    
    if (isDragging) {
      const maxStart = Math.max(0, duration - SNIPPET_DURATION);
      const newStart = Math.min(Math.max(0, time - SNIPPET_DURATION / 2), maxStart);
      setStartTime(newStart);
    }
  };

  const handleWaveformMouseDown = (e) => {
    setIsDragging(true);
    handleWaveformClick(e);
  };

  const handleWaveformMouseUp = () => {
    if (isDragging) {
      setIsDragging(false);
      updateVideoPreview(startTime);
    }
  };

  const handleWaveformMouseLeave = () => {
    setIsHovering(false);
    if (isDragging) {
      setIsDragging(false);
      updateVideoPreview(startTime);
    }
  };

  // Update video preview with debounce
  const updateVideoPreview = (time) => {
    if (updateTimerRef.current) {
      clearTimeout(updateTimerRef.current);
    }
    
    updateTimerRef.current = setTimeout(() => {
      if (playerRef.current && playerRef.current.seekTo) {
        playerRef.current.seekTo(time);
        if (!isPlaying) {
          playerRef.current.play();
          setTimeout(() => {
            if (playerRef.current && playerRef.current.pause) {
              playerRef.current.pause();
            }
          }, 1000); // Brief preview
        }
      }
    }, 150);
  };

  // Confirm selection
  const handleConfirm = () => {
    if (isFullSong) {
      // Full song - no snippet needed
      onConfirm({
        ...track,
        snippet: null
      });
    } else {
      onConfirm({
        ...track,
        snippet: {
          startTime,
          endTime
        }
      });
    }
  };

  // If full song mode, auto-confirm immediately (with guard to prevent repeated calls)
  useEffect(() => {
    if (isFullSong && track && !hasAutoConfirmedRef.current) {
      hasAutoConfirmedRef.current = true;
      onConfirm({ ...track, snippet: null });
    }
  }, [isFullSong, track, onConfirm]);

  return (
    <div className="snippet-modal z-50 fixed inset-0 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
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
          <div className="flex justify-between text-sm text-gray-400 mb-4">
            <span>{formatTime(startTime)}</span>
            <span className="text-green-400 font-semibold">{SNIPPET_DURATION} second snippet</span>
            <span>{formatTime(endTime)}</span>
          </div>

          {/* Instructions */}
          <div className="mb-4 text-center">
            <p className="text-sm text-gray-400">Click or drag on the waveform to select your {SNIPPET_DURATION}-second snippet</p>
          </div>

          {/* Interactive waveform timeline */}
          <div 
            ref={waveformRef}
            className="relative h-24 bg-[#242424] rounded-lg overflow-hidden mb-4 cursor-pointer select-none"
            onMouseDown={handleWaveformMouseDown}
            onMouseMove={handleWaveformMouseMove}
            onMouseUp={handleWaveformMouseUp}
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={handleWaveformMouseLeave}
          >
            {/* Time markers */}
            <div className="absolute inset-0 flex justify-between px-2 pt-1">
              {Array.from({ length: Math.min(10, Math.floor(duration / 30)) }).map((_, i) => {
                const time = (i * duration) / Math.min(10, Math.floor(duration / 30));
                return (
                  <div key={i} className="text-xs text-gray-600">
                    {formatTime(time)}
                  </div>
                );
              })}
            </div>
            
            {/* Waveform visualization */}
            <div className="absolute inset-0 flex items-end justify-around mt-4">
              {Array.from({ length: 100 }).map((_, i) => {
                const isInSelection = i >= (startTime / duration) * 100 && 
                                    i < ((startTime + SNIPPET_DURATION) / duration) * 100;
                const height = 20 + Math.sin(i * 0.2) * 30 + Math.random() * 20;
                return (
                  <div
                    key={i}
                    className={`w-0.5 transition-all duration-150 ${
                      isInSelection ? 'bg-green-400 opacity-80' : 'bg-[#3a3a3a] opacity-40'
                    }`}
                    style={{ height: `${height}%` }}
                  />
                );
              })}
            </div>
            
            {/* Removed hover indicator - times are shown below video */}
            
            {/* Selected 30s window */}
            <motion.div
              className="absolute top-0 bottom-0 bg-green-500 bg-opacity-30 border-x-2 border-green-400 transition-all duration-150 overflow-visible"
              style={{
                left: `${(startTime / duration) * 100}%`,
                width: `${(SNIPPET_DURATION / duration) * 100}%`
              }}
              animate={{ 
                scale: isDragging ? 1.02 : 1,
                opacity: isDragging ? 0.5 : 0.3
              }}
            >
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center z-10">
                <motion.span 
                  className="text-sm text-white font-semibold bg-green-600 px-3 py-1 rounded-full whitespace-nowrap"
                  animate={{ scale: isDragging ? 0.9 : 1 }}
                >
                  {formatTime(startTime)} – {formatTime(endTime)}
                </motion.span>
              </div>
            </motion.div>
            
            {/* Playback position */}
            {isPlaying && (
              <motion.div 
                className="absolute top-0 bottom-0 w-0.5 bg-white"
                style={{
                  left: `${(currentTime / duration) * 100}%`
                }}
                animate={{ opacity: [1, 0.7, 1] }}
                transition={{ repeat: Infinity, duration: 1 }}
              />
            )}
          </div>
          
          {/* Keyboard shortcuts hint */}
          <div className="text-xs text-gray-500 text-center mb-2">
            <span className="inline-flex items-center gap-2">
              <kbd className="px-2 py-1 bg-[#242424] rounded">←</kbd>
              <kbd className="px-2 py-1 bg-[#242424] rounded">→</kbd>
              to fine-tune • 
              <kbd className="px-2 py-1 bg-[#242424] rounded">Space</kbd>
              to preview
            </span>
          </div>
        </div>


        {/* Action buttons */}
        <div className="flex gap-4">
          <button
            onClick={handleConfirm}
            className="flex-1 py-3 bg-green-600 hover:bg-green-500 text-black rounded-md font-semibold transition-colors"
          >
            Confirm Selection
          </button>
          
          <button
            onClick={onCancel}
            className="flex-1 py-3 bg-[#242424] hover:bg-[#1a1a1a] text-white rounded-md transition-colors"
          >
            Cancel
          </button>
        </div>
      </motion.div>
    </div>
  );
}