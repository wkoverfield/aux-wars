import { memo, useRef, useState } from 'react';
import TrackPlayer from '../../components/TrackPlayer';

// Format time as M:SS
const formatTime = (seconds) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

/**
 * The clip being rated: the player (a YouTube window or an audio preview)
 * with its play button and scrubber. Playback position lives here, so the
 * several-times-a-second progress ticks re-render only this component, and
 * with stable props a rating tap on the screen around it does not re-render
 * the player. Give it a `key` per song to reset it.
 *
 * @param {Object} props
 * @param {string} [props.videoId] - YouTube video id (full song)
 * @param {string} [props.previewUrl] - Audio preview URL (30s clip)
 * @param {number} props.startTime - Clip window start, seconds
 * @param {number} props.endTime - Clip window end, seconds
 */
function ClipPlayer({ videoId, previewUrl, startTime, endTime }) {
  const [progress, setProgress] = useState(0); // 0-1 playback progress
  const [playbackTime, setPlaybackTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const playerRef = useRef(null);
  const isSeekingRef = useRef(false); // true while dragging the scrubber, so playback ticks don't fight the thumb

  const hasPlayable = !!(previewUrl || videoId);
  if (!hasPlayable) return null;

  const handleTogglePlayback = () => {
    playerRef.current?.toggle?.();
  };

  const handleSeek = (seconds) => {
    const next = Math.max(0, Math.min(seconds, duration || seconds));
    playerRef.current?.seekTo?.(next);
    setPlaybackTime(next);
    setProgress(duration > 0 ? Math.min(1, next / duration) : 0);
  };

  return (
    <>
      <div className="w-full mb-3 flex justify-center">
        <div className="w-full max-w-[min(28rem,46vh)]">
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
            if (isSeekingRef.current) return; // don't yank the thumb back mid-scrub
            setPlaybackTime(t);
            setProgress(duration > 0 ? Math.min(1, t / duration) : 0);
          }}
          onPlayingChange={setIsPlaying}
        />
        </div>
      </div>

      {/* Playback controls */}
      {duration > 0 && (
        <div className="w-full max-w-md mb-5 px-1">
          <div className="flex items-center gap-3 rounded-[8px] border border-white/10 bg-[#111]/90 px-3 py-3">
            <button
              type="button"
              data-vital="play"
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
                onPointerDown={() => { isSeekingRef.current = true; }}
                onPointerUp={() => { isSeekingRef.current = false; }}
                onPointerCancel={() => { isSeekingRef.current = false; }}
                onLostPointerCapture={() => { isSeekingRef.current = false; }}
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
    </>
  );
}

export default memo(ClipPlayer);
