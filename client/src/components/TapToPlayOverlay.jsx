/**
 * Branded "tap to play" overlay shared by the full-song players (YouTube,
 * SoundCloud). It is the primary action on mobile, where autoplay with sound
 * is blocked: the tap is the user gesture, so `onClick` must start playback
 * synchronously. Covers its positioned parent.
 *
 * @param {Function} props.onClick  - starts playback
 * @param {boolean}  props.disabled - true until the player is ready
 */
export default function TapToPlayOverlay({ onClick, disabled = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Play"
      disabled={disabled}
      className="absolute inset-0 flex items-center justify-center bg-black/35 disabled:cursor-wait"
    >
      <span className="relative flex items-center justify-center">
        <span className="absolute h-16 w-16 rounded-full bg-[#1db954] opacity-60 animate-ping" aria-hidden="true" />
        <span className="relative flex items-center justify-center w-16 h-16 rounded-full bg-[#1db954] text-black shadow-lg">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M8 5.14v13.72a1 1 0 0 0 1.54.84l10.29-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14z" />
          </svg>
        </span>
      </span>
    </button>
  );
}
