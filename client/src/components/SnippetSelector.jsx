import React, { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import TrackPlayer from './TrackPlayer';

/**
 * SnippetSelector — pick the clip to submit.
 *
 * YouTube track (full song): a window picker. Slide a fixed-length window
 * (snippetDuration; 0 = full song) to ANY point in the song and the preview
 * re-plays that window live so you HEAR the part you're choosing. Submits
 * `snippet: { startTime, endTime }`.
 *
 * iTunes/Deezer track (30s preview, fallback): just preview & confirm — the
 * whole clip is the snippet, so `snippet` is null.
 *
 * @param {Object}   props.ref             - React 19 ref; exposes getCurrentSelection() for auto-submit on timer expiry
 * @param {Object}   props.track           - The selected track (app shape; videoId => YouTube)
 * @param {Function} props.onConfirm       - Called with the track (+ snippet) to submit
 * @param {Function} props.onCancel        - Called when the player backs out
 * @param {number}   props.snippetDuration - Window length in seconds (0 = full song); default 30
 */
export default function SnippetSelector({ track, onConfirm, onCancel, snippetDuration = 30, ref }) {
  const playerRef = useRef(null);
  const videoId = track?.videoId;
  const albumCover = track?.album?.images?.[0]?.url;
  const artist = track?.artists?.[0]?.name || '';

  // Fixed window length. 0 = full song (no windowing).
  const len = snippetDuration === 0 ? 0 : (snippetDuration || 30);
  const [duration, setDuration] = useState(0); // full song length (seconds)
  const [start, setStart] = useState(0);       // window start (seconds)
  const [previewTime, setPreviewTime] = useState(0); // current time inside the selected window
  const [isPreviewing, setIsPreviewing] = useState(false);

  const maxStart = len > 0 && duration > 0 ? Math.max(0, duration - len) : 0;
  const end = len > 0 ? Math.min(start + len, duration > 0 ? duration : start + len) : 0;
  const isWindowed = !!videoId && len > 0;
  const startPercent = duration > 0 ? (Math.min(start, maxStart) / duration) * 100 : 0;
  const windowPercent = duration > 0 ? Math.min(100, (len / duration) * 100) : 0;
  const playedWindowPercent = len > 0 ? Math.min(100, (Math.min(previewTime, len) / len) * 100) : 0;

  const formatTime = (s) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  // Clamp the start once we learn the full duration (so the window never runs past the end).
  useEffect(() => {
    if (duration > 0 && start > maxStart) setStart(maxStart);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration]);

  useEffect(() => {
    setPreviewTime(0);
  }, [start, videoId]);

  // Build what we submit. YouTube + a real window => snippet; otherwise null.
  const buildSelection = () => {
    if (!videoId || len === 0 || duration === 0) {
      return { ...track, snippet: null };
    }
    return {
      ...track,
      snippet: { startTime: Math.round(start), endTime: Math.round(Math.min(start + len, duration)) },
    };
  };

  useImperativeHandle(
    ref,
    () => ({ getCurrentSelection: () => buildSelection() }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [track, start, duration, len, videoId]
  );

  // Latest handlers in refs so the keydown listener binds once but never goes stale.
  const confirmRef = useRef(null);
  const cancelRef = useRef(null);
  confirmRef.current = () => onConfirm(buildSelection());
  cancelRef.current = () => onCancel();

  // Keyboard: Enter = confirm, Escape = cancel, Space = play/pause (but let the
  // focused range slider keep its native key behavior).
  useEffect(() => {
    const handleKeyPress = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        confirmRef.current?.();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelRef.current?.();
      } else if (e.key === ' ') {
        if (e.target?.tagName === 'INPUT') return;
        e.preventDefault();
        playerRef.current?.toggle();
      }
    };
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, []);

  const handleConfirm = () => onConfirm(buildSelection());

  return (
    <div className="snippet-modal z-50 fixed inset-0 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-[#181818] rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto shadow-2xl"
      >
        <h2 className="text-2xl font-bold text-white mb-1">
          {isWindowed ? 'Clip your moment' : 'Preview your pick'}
        </h2>
        <p className="text-sm text-gray-400 mb-5">
          {isWindowed ? 'Slide to the part you want everyone to hear.' : 'Have a listen, then lock it in.'}
        </p>

        {/* Media: YouTube video (windowed) OR album art + audio preview */}
        {videoId ? (
          <div className="mb-5">
            <TrackPlayer
              ref={playerRef}
              videoId={videoId}
              startTime={start}
              endTime={end}
              autoPlay
              loop
              showControls
              onDuration={(d) => setDuration(d)}
              onTimeUpdate={(t) => setPreviewTime(t)}
              onPlayingChange={setIsPreviewing}
            />
          </div>
        ) : (
          <>
            {albumCover && (
              <div className="flex justify-center mb-5">
                <img
                  src={albumCover}
                  alt={`${track.name} album art`}
                  className="w-44 h-44 rounded-lg object-cover shadow-lg"
                />
              </div>
            )}
            <div className="flex justify-center mb-6">
              <TrackPlayer ref={playerRef} src={track?.preview_url} autoPlay loop showControls />
            </div>
          </>
        )}

        {/* Track info */}
        <div className="text-center mb-5">
          <p className="text-lg text-white font-semibold truncate">{track?.name}</p>
          <p className="text-gray-400 truncate">{artist}</p>
        </div>

        {/* Window picker — YouTube + a real clip length only */}
        {isWindowed && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 }}
            className="mb-6"
          >
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="font-semibold text-[#68d570]">{len}s clip</span>
              <span className="tabular-nums text-gray-400">
                {duration > 0 ? `${formatTime(start)} - ${formatTime(end)}` : 'Loading'}
              </span>
            </div>

            <div className="relative flex h-8 w-full items-center">
              <div className="absolute left-0 right-0 h-1.5 rounded-full bg-[#333]" />
              {duration > 0 && (
                <div
                  className="absolute h-1.5 overflow-hidden rounded-full bg-[#68d570]"
                  style={{
                    left: `${startPercent}%`,
                    width: `${windowPercent}%`,
                  }}
                >
                  <div
                    className="h-full bg-[#8ee695]"
                    style={{ width: isPreviewing ? `${playedWindowPercent}%` : '0%' }}
                  />
                </div>
              )}
              <input
                type="range"
                className="slider snippet-window-slider absolute inset-0 h-8 w-full"
                min={0}
                max={duration > 0 ? Math.floor(duration) : 0}
                step={1}
                value={Math.min(start, maxStart)}
                disabled={duration === 0}
                onChange={(e) => {
                  setStart(Math.min(Number(e.target.value), maxStart));
                  setPreviewTime(0);
                }}
                aria-label="Clip start position"
              />
            </div>

            <div className="mt-1 flex items-center justify-between text-xs tabular-nums text-gray-500">
              <span>0:00</span>
              <span className={isPreviewing ? 'text-white' : ''}>
                {formatTime(start + previewTime)}
              </span>
              <span>{duration > 0 ? formatTime(duration) : 'Loading'}</span>
            </div>
          </motion.div>
        )}

        {/* Full-song mode note */}
        {!!videoId && len === 0 && (
          <p className="text-center text-sm text-gray-400 mb-6">Playing the full song.</p>
        )}

        {/* Action buttons */}
        <div className="flex gap-4">
          <button
            onClick={handleConfirm}
            aria-label="Confirm selection"
            className="flex-1 py-3 bg-green-600 hover:bg-green-500 text-black rounded-md font-semibold transition-colors"
          >
            Confirm Selection
          </button>

          <button
            onClick={onCancel}
            aria-label="Cancel"
            className="flex-1 py-3 bg-[#242424] hover:bg-[#1a1a1a] text-white rounded-md transition-colors"
          >
            Cancel
          </button>
        </div>
      </motion.div>
    </div>
  );
}
