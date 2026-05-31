import React, { useEffect, useImperativeHandle, useRef } from 'react';
import { motion } from 'framer-motion';
import AudioPreviewPlayer from './AudioPreviewPlayer';

/**
 * SnippetSelector — preview & confirm a track before submitting it.
 *
 * Music previews are fixed ~30s clips (iTunes / Deezer), so there is no longer a
 * window to select within a full song. This modal lets the player hear the clip
 * and confirm. The whole preview clip is the snippet, so `snippet` is null.
 *
 * @param {Object}   props.ref       - React 19 ref prop; exposes getCurrentSelection() for auto-submit on timer expiry
 * @param {Object}   props.track     - The selected track (app shape)
 * @param {Function} props.onConfirm - Called with the track to submit
 * @param {Function} props.onCancel  - Called when the player backs out
 */
export default function SnippetSelector({ ref, track, onConfirm, onCancel }) {
  const playerRef = useRef(null);

  const albumCover = track?.album?.images?.[0]?.url;
  const artist = track?.artists?.[0]?.name || '';

  // Expose current selection to parent for auto-submit on timer expiry.
  // The 30s preview clip IS the snippet, so snippet is null.
  useImperativeHandle(
    ref,
    () => ({
      getCurrentSelection: () => ({ ...track, snippet: null }),
    }),
    [track]
  );

  const handleConfirm = () => {
    onConfirm({ ...track, snippet: null });
  };

  // Keyboard controls: Enter = confirm, Escape = cancel, Space = play/pause preview
  useEffect(() => {
    const handleKeyPress = (e) => {
      switch (e.key) {
        case 'Enter':
          e.preventDefault();
          handleConfirm();
          break;
        case 'Escape':
          e.preventDefault();
          onCancel();
          break;
        case ' ':
          e.preventDefault();
          playerRef.current?.toggle();
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track]);

  return (
    <div className="snippet-modal z-50 fixed inset-0 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-[#181818] rounded-lg p-6 max-w-md w-full max-h-[90vh] overflow-y-auto shadow-2xl"
      >
        <h2 className="text-2xl font-bold text-white mb-1">Preview your pick</h2>
        <p className="text-sm text-gray-400 mb-5">Have a listen, then lock it in.</p>

        {/* Album art */}
        {albumCover && (
          <div className="flex justify-center mb-5">
            <img
              src={albumCover}
              alt={`${track.name} album art`}
              className="w-44 h-44 rounded-lg object-cover shadow-lg"
            />
          </div>
        )}

        {/* Track info */}
        <div className="text-center mb-5">
          <p className="text-lg text-white font-semibold truncate">{track?.name}</p>
          <p className="text-gray-400 truncate">{artist}</p>
        </div>

        {/* Preview player */}
        <div className="flex justify-center mb-6">
          <AudioPreviewPlayer
            ref={playerRef}
            src={track?.preview_url}
            autoPlay
            loop
            showControls
          />
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
