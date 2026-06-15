import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';

/**
 * YouTubePlayerWithRef
 *
 * Plays a window [startTime, endTime] of a full YouTube video via the IFrame
 * Player API. Mirrors AudioPreviewPlayer's imperative ref API + callbacks so
 * TrackPlayer can swap the two transparently:
 *   play(), pause(), toggle(), seekTo(s), getCurrentTime(), getDuration(), isPlaying()
 *
 * Callbacks report WINDOW-RELATIVE time so a progress bar built for a 30s clip
 * works unchanged: onReady(windowLength), onTimeUpdate(currentTime - startTime).
 *
 * ADS/ToS NOTE (dormant-but-real): running our OWN ads next to this embed
 * violates YouTube's API ToS. We serve no ads today (VITE_ADSENSE_CLIENT unset),
 * so it's dormant — if ads are re-enabled, gate YouTube playback to ad-free rooms.
 *
 * @param {string}   props.videoId      - YouTube video id
 * @param {number}   props.startTime    - window start (seconds into the full song)
 * @param {number}   props.endTime      - window end (0 = play to natural end)
 * @param {boolean}  props.autoPlay     - attempt play once ready (mobile usually blocks → tap)
 * @param {boolean}  props.loop         - loop the window
 * @param {boolean}  props.showControls - show the branded "tap to play" overlay (default true)
 * @param {Function} props.onReady      - called with window length (seconds)
 * @param {Function} props.onTimeUpdate - called with window-relative currentTime (seconds)
 * @param {Function} props.onEnded      - called at window/video end (when not looping)
 * @param {Function} props.onDuration   - called with the FULL song length (seconds) — for the window picker
 * @param {string}   props.className    - wrapper classes
 */

// Load the IFrame Player API exactly once for the whole app (per-component
// loading clobbers window.onYouTubeIframeAPIReady when two players mount).
let ytApiPromise = null;
function loadYouTubeApi() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (ytApiPromise) return ytApiPromise;
  ytApiPromise = new Promise((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
    window.onYouTubeIframeAPIReady = () => {
      if (typeof prev === 'function') { try { prev(); } catch { /* noop */ } }
      resolve(window.YT);
    };
  });
  return ytApiPromise;
}

const YouTubePlayerWithRef = forwardRef(function YouTubePlayerWithRef(
  {
    videoId,
    startTime = 0,
    endTime = 0,
    autoPlay = false,
    loop = false,
    showControls = true,
    onReady,
    onTimeUpdate,
    onEnded,
    onDuration,
    className = '',
  },
  ref
) {
  const hostRef = useRef(null);     // div the API replaces with the iframe
  const playerRef = useRef(null);   // YT.Player instance
  const intervalRef = useRef(null); // window-enforcement poll
  const [hasStarted, setHasStarted] = useState(false);

  // Keep latest window/callbacks in refs so the poll + events never go stale
  // and we don't have to recreate the player when they change.
  const startRef = useRef(startTime);
  const endRef = useRef(endTime);
  const loopRef = useRef(loop);
  const autoPlayRef = useRef(autoPlay);
  const cbRef = useRef({ onReady, onTimeUpdate, onEnded, onDuration });
  useEffect(() => { loopRef.current = loop; }, [loop]);
  useEffect(() => { autoPlayRef.current = autoPlay; }, [autoPlay]);
  useEffect(() => { cbRef.current = { onReady, onTimeUpdate, onEnded, onDuration }; });

  const stopPolling = () => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
  };

  const startPolling = () => {
    stopPolling();
    intervalRef.current = setInterval(() => {
      const p = playerRef.current;
      if (!p || typeof p.getCurrentTime !== 'function') return;
      const t = p.getCurrentTime() || 0;
      const start = startRef.current || 0;
      const end = endRef.current || 0;
      cbRef.current.onTimeUpdate?.(Math.max(0, t - start));
      if (end > 0 && t >= end) {
        if (loopRef.current) {
          p.seekTo(start, true);
        } else {
          p.pauseVideo();
          cbRef.current.onEnded?.();
        }
      }
    }, 250);
  };

  // Re-anchor the preview when the window moves (e.g. scrubbing in the picker).
  useEffect(() => {
    startRef.current = startTime;
    endRef.current = endTime;
    const p = playerRef.current;
    if (p && typeof p.seekTo === 'function') {
      try { p.seekTo(startTime || 0, true); } catch { /* not ready */ }
    }
  }, [startTime, endTime]);

  // Create / destroy the player when the video changes. key={videoId} on the
  // host div guarantees a fresh DOM node per video (the API mutates it).
  useEffect(() => {
    if (!videoId) return undefined;
    let cancelled = false;
    setHasStarted(false);

    loadYouTubeApi().then((YT) => {
      if (cancelled || !hostRef.current) return;
      playerRef.current = new YT.Player(hostRef.current, {
        width: '100%',
        height: '100%',
        videoId,
        playerVars: {
          autoplay: 0, // we drive play() after ready so we can seek first
          controls: 1,
          modestbranding: 1,
          rel: 0,
          playsinline: 1, // critical: no iOS fullscreen hijack
          fs: 1,
          start: Math.floor(startRef.current || 0),
          end: endRef.current > 0 ? Math.floor(endRef.current) : undefined,
          origin: window.location.origin,
        },
        events: {
          onReady: (e) => {
            const player = e.target;
            const start = startRef.current || 0;
            const end = endRef.current || 0;
            const full = player.getDuration?.() || 0;
            cbRef.current.onDuration?.(full);
            cbRef.current.onReady?.(end > 0 ? Math.max(0, end - start) : full);
            if (start > 0) { try { player.seekTo(start, true); } catch { /* noop */ } }
            if (autoPlayRef.current) { try { player.playVideo(); } catch { /* blocked */ } }
            startPolling();
          },
          onStateChange: (e) => {
            const YTNS = window.YT;
            if (!YTNS) return;
            if (e.data === YTNS.PlayerState.PLAYING) setHasStarted(true);
            if (e.data === YTNS.PlayerState.ENDED) {
              if (loopRef.current) {
                try { e.target.seekTo(startRef.current || 0, true); e.target.playVideo(); } catch { /* noop */ }
              } else {
                cbRef.current.onEnded?.();
              }
            }
          },
        },
      });
    });

    return () => {
      cancelled = true;
      stopPolling();
      try { playerRef.current?.destroy?.(); } catch { /* noop */ }
      playerRef.current = null;
    };
    // Recreate only when the video changes; refs carry the latest window/cb.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  useImperativeHandle(ref, () => ({
    play: () => { try { playerRef.current?.playVideo?.(); } catch { /* noop */ } },
    pause: () => { try { playerRef.current?.pauseVideo?.(); } catch { /* noop */ } },
    toggle: () => {
      const p = playerRef.current; const YT = window.YT;
      if (!p || !YT) return;
      if (p.getPlayerState?.() === YT.PlayerState.PLAYING) p.pauseVideo();
      else p.playVideo();
    },
    seekTo: (s) => { if (Number.isFinite(s)) { try { playerRef.current?.seekTo?.(Math.max(0, s), true); } catch { /* noop */ } } },
    getCurrentTime: () => playerRef.current?.getCurrentTime?.() || 0,
    getDuration: () => playerRef.current?.getDuration?.() || 0,
    isPlaying: () => {
      const p = playerRef.current; const YT = window.YT;
      return !!(p && YT && p.getPlayerState?.() === YT.PlayerState.PLAYING);
    },
  }), []);

  if (!videoId) return null;

  const handleTapToPlay = () => { try { playerRef.current?.playVideo?.(); } catch { /* noop */ } };

  return (
    <div className={`relative w-full aspect-video overflow-hidden rounded-xl bg-black ring-1 ring-white/10 ${className}`}>
      <div key={videoId} ref={hostRef} className="w-full h-full" />

      {/* Branded "tap to play" — the primary action on mobile, where autoplay
          with sound is blocked. Shown until the first play, then native
          controls take over. */}
      {showControls && !hasStarted && (
        <button
          type="button"
          onClick={handleTapToPlay}
          aria-label="Play"
          className="absolute inset-0 flex items-center justify-center bg-black/35"
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
      )}
    </div>
  );
});

export default YouTubePlayerWithRef;
export { YouTubePlayerWithRef };
