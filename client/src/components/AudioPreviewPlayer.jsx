import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

/**
 * AudioPreviewPlayer
 *
 * Plays a 30-second preview clip (iTunes / Deezer `preview` URL) via a plain
 * HTML5 <audio> element. Replaces the old YouTube IFrame player.
 *
 * Exposes an imperative ref API so callers can drive playback:
 *   play(), pause(), toggle(), seekTo(seconds), getCurrentTime(), getDuration(), isPlaying()
 *
 * @param {string}   props.src          - Direct audio URL (the track preview_url)
 * @param {boolean}  props.autoPlay     - Attempt to play once metadata loads (mobile may block until a tap)
 * @param {boolean}  props.loop         - Loop the clip
 * @param {boolean}  props.showControls - Render the built-in play/pause button (default true)
 * @param {Function} props.onReady      - Called with duration (seconds) when metadata loads
 * @param {Function} props.onTimeUpdate - Called with currentTime (seconds) as playback progresses
 * @param {Function} props.onEnded      - Called when the clip finishes (and not looping)
 * @param {string}   props.className    - Wrapper classes
 */
const AudioPreviewPlayer = forwardRef(function AudioPreviewPlayer(
  {
    src,
    autoPlay = false,
    loop = false,
    showControls = true,
    onReady,
    onTimeUpdate,
    onEnded,
    className = '',
  },
  ref
) {
  const audioRef = useRef(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasError, setHasError] = useState(false);

  useImperativeHandle(
    ref,
    () => ({
      play: () => audioRef.current?.play().catch(() => {}),
      pause: () => audioRef.current?.pause(),
      toggle: () => {
        const a = audioRef.current;
        if (!a) return;
        if (a.paused) a.play().catch(() => {});
        else a.pause();
      },
      seekTo: (seconds) => {
        if (audioRef.current && Number.isFinite(seconds)) {
          audioRef.current.currentTime = Math.max(0, seconds);
        }
      },
      getCurrentTime: () => audioRef.current?.currentTime || 0,
      getDuration: () => audioRef.current?.duration || 0,
      isPlaying: () => !!audioRef.current && !audioRef.current.paused,
    }),
    []
  );

  // Reset transient state when the source changes
  useEffect(() => {
    setIsPlaying(false);
    setHasError(false);
  }, [src]);

  const handleLoadedMetadata = () => {
    onReady?.(audioRef.current?.duration || 0);
    if (autoPlay) {
      audioRef.current?.play().catch(() => {
        // Autoplay blocked (mobile) — user can tap to start
      });
    }
  };

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  };

  return (
    <div className={`audio-preview-player flex items-center justify-center ${className}`}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        loop={loop}
        onLoadedMetadata={handleLoadedMetadata}
        onTimeUpdate={() => onTimeUpdate?.(audioRef.current?.currentTime || 0)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => {
          setIsPlaying(false);
          onEnded?.();
        }}
        onError={() => setHasError(true)}
      />

      {showControls && (
        <button
          type="button"
          onClick={togglePlay}
          disabled={hasError || !src}
          aria-label={isPlaying ? 'Pause preview' : 'Play preview'}
          className="flex items-center justify-center w-16 h-16 rounded-full bg-[#1db954] hover:bg-[#1ed760] text-black transition-all hover:scale-105 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg"
        >
          {isPlaying ? (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <rect x="6" y="5" width="4" height="14" rx="1" />
              <rect x="14" y="5" width="4" height="14" rx="1" />
            </svg>
          ) : (
            <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M8 5.14v13.72a1 1 0 0 0 1.54.84l10.29-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14z" />
            </svg>
          )}
        </button>
      )}

      {hasError && (
        <p className="text-xs text-red-400 ml-3">Preview unavailable</p>
      )}
    </div>
  );
});

export default AudioPreviewPlayer;
