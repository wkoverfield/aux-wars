import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import TapToPlayOverlay from './TapToPlayOverlay';
import soundcloudLogo from '../assets/soundcloud-logo-white.png';

/**
 * SoundCloudPlayerWithRef
 *
 * Plays a window [startTime, endTime] of a full SoundCloud track. The
 * SoundCloud Widget is the audio engine only: its iframe stays in the DOM at
 * 1px and invisible (never display:none, which stops it loading), and this
 * component draws its own box. Same imperative ref API + callbacks as
 * YouTubePlayer so TrackPlayer can swap them transparently:
 *   play(), pause(), toggle(), seekTo(s), getCurrentTime(), getDuration(), isPlaying()
 *
 * Callbacks report WINDOW-RELATIVE time: onReady(windowLength),
 * onTimeUpdate(currentTime - startTime).
 *
 * ATTRIBUTION (SoundCloud "Buttons and logos" rules for a custom player):
 * the uploader is credited by name, the official SoundCloud logo is shown and
 * the logo and title link to the track on SoundCloud. The logo file is the
 * official asset and must stay unaltered: no recolor, crop, distortion or
 * redraw, the white logo only on #121212, and never under 30px wide.
 *
 * ADS NOTE: no ad slot on any screen that can show SoundCloud content: this
 * player, SoundCloud artwork, or titles from SoundCloud. Those are the same
 * screens the YouTube rule already keeps ad-free (song selection, rating,
 * round results, game over, /screen); see services/ads.js.
 *
 * @param {string}   props.soundcloudUrl - canonical track URL (https://soundcloud.com/<user>/<track>)
 * @param {string}   props.name         - track title
 * @param {string}   props.artist       - uploader name
 * @param {string}   props.artwork      - artwork image URL
 * @param {number}   props.startTime    - window start (seconds into the full track)
 * @param {number}   props.endTime      - window end (0 = play to natural end)
 * @param {boolean}  props.autoPlay     - attempt play once ready (mobile usually blocks → tap)
 * @param {boolean}  props.loop         - loop the window
 * @param {boolean}  props.showControls - show the branded "tap to play" overlay (default true)
 * @param {Function} props.onReady      - called with window length (seconds)
 * @param {Function} props.onTimeUpdate - called with window-relative currentTime (seconds)
 * @param {Function} props.onEnded      - called at window/track end (when not looping)
 * @param {Function} props.onDuration   - called with the FULL track length (seconds) — for the window picker
 * @param {string}   props.className    - wrapper classes
 */

const WIDGET_API_SRC = 'https://w.soundcloud.com/player/api.js';
// No READY in this long means the track cannot be embedded (the widget does
// not always send ERROR for a removed, private or embed-disabled track).
const READY_TIMEOUT_MS = 8000;
// PLAY_PROGRESS arrives many times a second; the window end is checked on
// every event, but React state and onTimeUpdate are fed at this pace.
const PROGRESS_EMIT_MS = 200;
// How far before the window start a play may begin before it is re-seeked.
const START_TOLERANCE_S = 0.25;

// Load the Widget API exactly once for the whole app.
let scApiPromise = null;
function loadSoundCloudApi() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.SC && window.SC.Widget) return Promise.resolve(window.SC);
  if (scApiPromise) return scApiPromise;
  scApiPromise = new Promise((resolve, reject) => {
    const tag = document.createElement('script');
    tag.src = WIDGET_API_SRC;
    tag.onload = () => {
      if (window.SC && window.SC.Widget) resolve(window.SC);
      else reject(new Error('SoundCloud widget API missing'));
    };
    tag.onerror = () => {
      // Let a later player try again instead of failing for the whole session.
      scApiPromise = null;
      tag.remove();
      reject(new Error('SoundCloud widget API failed to load'));
    };
    document.head.appendChild(tag);
  });
  return scApiPromise;
}

const widgetSrc = (trackUrl) =>
  `https://w.soundcloud.com/player/?url=${encodeURIComponent(trackUrl)}&auto_play=false&single_active=false`;

const SoundCloudPlayerWithRef = forwardRef(function SoundCloudPlayerWithRef(
  {
    soundcloudUrl,
    name = '',
    artist = '',
    artwork = '',
    startTime = 0,
    endTime = 0,
    autoPlay = false,
    loop = false,
    showControls = true,
    onReady,
    onTimeUpdate,
    onEnded,
    onDuration,
    onPlayingChange,
    className = '',
  },
  ref
) {
  const hostRef = useRef(null);    // stable wrapper React owns; holds the widget iframe
  const widgetRef = useRef(null);  // SC.Widget instance
  const mountedRef = useRef(false);
  const [hasStarted, setHasStarted] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [currentTime, setCurrentTime] = useState(0); // window-relative
  const [duration, setDuration] = useState(0);       // window length
  const [playerError, setPlayerError] = useState(false);

  // Keep latest window/callbacks in refs so widget events never go stale and
  // we don't have to recreate the widget when they change.
  const startRef = useRef(startTime);
  const endRef = useRef(endTime);
  const loopRef = useRef(loop);
  const autoPlayRef = useRef(autoPlay);
  const cbRef = useRef({ onReady, onTimeUpdate, onEnded, onDuration, onPlayingChange });
  useEffect(() => { loopRef.current = loop; }, [loop]);
  useEffect(() => { autoPlayRef.current = autoPlay; }, [autoPlay]);
  useEffect(() => { cbRef.current = { onReady, onTimeUpdate, onEnded, onDuration, onPlayingChange }; });

  // Playback bookkeeping. The widget is driven over postMessage, so intent
  // (what we asked for) is tracked apart from what its events report.
  const readyRef = useRef(false);
  const fullDurationRef = useRef(0);   // full track length (seconds)
  const wantPlayingRef = useRef(false); // we asked for playback
  const playingRef = useRef(false);     // playing at our request (last reported)
  const anchorRef = useRef(0);          // last position we seeked to (absolute seconds)
  const pendingSeekRef = useRef(null);  // seek to this (absolute seconds) before the next play
  const endedRef = useRef(false);       // the window or track ran out (not looping)
  const rewindingRef = useRef(false);   // a loop seek is in flight
  const lastEmitRef = useRef(0);

  const getWindowDuration = (fullDuration = 0) => {
    const start = startRef.current || 0;
    const end = endRef.current || 0;
    if (end > start) return Math.max(0, end - start);
    return Math.max(0, fullDuration - start);
  };

  const seekAbsolute = (seconds) => {
    anchorRef.current = seconds;
    try { widgetRef.current?.seekTo(Math.round(seconds * 1000)); } catch { /* noop */ }
  };

  const emitTime = (relative, force = false) => {
    const now = Date.now();
    if (!force && now - lastEmitRef.current < PROGRESS_EMIT_MS) return;
    lastEmitRef.current = now;
    setCurrentTime(relative);
    cbRef.current.onTimeUpdate?.(relative);
  };

  const setPlaying = (playing) => {
    if (playingRef.current === playing) return;
    playingRef.current = playing;
    cbRef.current.onPlayingChange?.(playing);
  };

  // Seek to the window start (or wherever playback should resume) BEFORE
  // play, in the same tick, so a tap that calls this starts the right audio.
  const requestPlay = () => {
    const w = widgetRef.current;
    if (!w || !readyRef.current) return;
    wantPlayingRef.current = true;
    endedRef.current = false;
    if (pendingSeekRef.current !== null) {
      seekAbsolute(pendingSeekRef.current);
      pendingSeekRef.current = null;
    }
    try { w.play(); } catch { /* blocked */ }
  };

  const requestPause = () => {
    wantPlayingRef.current = false;
    try { widgetRef.current?.pause(); } catch { /* noop */ }
  };

  const seekToWindowTime = (seconds) => {
    if (!readyRef.current || !Number.isFinite(seconds)) return;
    const windowLength = duration || getWindowDuration(fullDurationRef.current);
    const relative = Math.max(0, windowLength > 0 ? Math.min(seconds, windowLength) : seconds);
    endedRef.current = false;
    pendingSeekRef.current = null;
    seekAbsolute((startRef.current || 0) + relative);
    emitTime(relative, true);
  };

  // Re-anchor the preview when the window moves (e.g. scrubbing in the picker).
  useEffect(() => {
    startRef.current = startTime;
    endRef.current = endTime;
    const start = startTime || 0;
    if (readyRef.current) {
      endedRef.current = false;
      if (wantPlayingRef.current) {
        pendingSeekRef.current = null;
        seekAbsolute(start);
      } else {
        // Paused: a seek can start playback by itself, so move on the next play.
        anchorRef.current = start;
        pendingSeekRef.current = start;
      }
    }
    setCurrentTime(0);
    setDuration(getWindowDuration(fullDurationRef.current));
  }, [startTime, endTime]);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Create / destroy the widget when the track changes. The iframe is created
  // imperatively inside a stable wrapper, after the API has loaded, so the
  // widget's READY message always has a listener.
  useEffect(() => {
    if (!soundcloudUrl) return undefined;
    let cancelled = false;
    let widget = null;
    let events = null;
    const host = hostRef.current;
    setHasStarted(false);
    setIsReady(false);
    setCurrentTime(0);
    setDuration(0);
    setPlayerError(false);
    readyRef.current = false;
    fullDurationRef.current = 0;
    wantPlayingRef.current = false;
    playingRef.current = false;
    anchorRef.current = startRef.current || 0;
    pendingSeekRef.current = null;
    endedRef.current = false;
    rewindingRef.current = false;
    lastEmitRef.current = 0;
    let failed = false; // the widget reported ERROR: a late READY does not undo it

    const readyTimer = setTimeout(() => {
      if (cancelled || !mountedRef.current || readyRef.current) return;
      setPlayerError(true);
    }, READY_TIMEOUT_MS);

    const endPlayback = () => {
      wantPlayingRef.current = false;
      endedRef.current = true;
      pendingSeekRef.current = startRef.current || 0; // a replay starts the window over
      setPlaying(false);
      cbRef.current.onEnded?.();
    };

    loadSoundCloudApi().then((SC) => {
      if (cancelled || !host) return;

      host.replaceChildren();
      const iframe = document.createElement('iframe');
      iframe.src = widgetSrc(soundcloudUrl);
      // Same permissions as SoundCloud's own embed code (its oEmbed html):
      // autoplay so a tap in this page can start audio in the frame, and
      // encrypted-media for tracks the widget serves as protected streams.
      iframe.setAttribute('allow', 'autoplay; encrypted-media');
      iframe.setAttribute('title', 'SoundCloud audio');
      iframe.setAttribute('tabindex', '-1');
      iframe.setAttribute('scrolling', 'no');
      iframe.style.cssText = 'width:1px;height:1px;border:0;opacity:0;pointer-events:none;';
      host.appendChild(iframe);

      widget = SC.Widget(iframe);
      widgetRef.current = widget;
      events = SC.Widget.Events;

      widget.bind(events.READY, () => {
        if (cancelled || !mountedRef.current) return;
        widget.getDuration((ms) => {
          if (cancelled || !mountedRef.current || failed) return;
          clearTimeout(readyTimer);
          const start = startRef.current || 0;
          const end = endRef.current || 0;
          const full = (ms || 0) / 1000;
          const windowLength = getWindowDuration(full);
          fullDurationRef.current = full;
          readyRef.current = true;
          setPlayerError(false);
          setIsReady(true);
          setDuration(windowLength);
          cbRef.current.onDuration?.(full);
          cbRef.current.onReady?.(end > 0 ? Math.max(0, end - start) : windowLength);
          anchorRef.current = start;
          // Park at the window start so the first play begins there. This
          // seek can start playback by itself; the PLAY handler pauses it
          // again unless play was asked for.
          if (start > 0) seekAbsolute(start);
          if (autoPlayRef.current) requestPlay();
        });
      });

      widget.bind(events.PLAY, (e) => {
        if (cancelled || !mountedRef.current) return;
        if (!wantPlayingRef.current) {
          // Nobody asked for sound (a seek started it). Stay paused, and
          // return to where we meant to be on the next play.
          pendingSeekRef.current = anchorRef.current;
          try { widget.pause(); } catch { /* noop */ }
          return;
        }
        const start = startRef.current || 0;
        const end = endRef.current || 0;
        const t = Number.isFinite(e?.currentPosition) ? e.currentPosition / 1000 : start;
        // The seek before play did not take (or playback sits past the
        // window): put it back at the window start.
        if (t < start - START_TOLERANCE_S || (end > 0 && t >= end)) seekAbsolute(start);
        setHasStarted(true);
        setPlaying(true);
      });

      widget.bind(events.PAUSE, () => {
        if (cancelled || !mountedRef.current) return;
        setPlaying(false);
      });

      widget.bind(events.PLAY_PROGRESS, (e) => {
        if (cancelled || !mountedRef.current) return;
        if (!wantPlayingRef.current || endedRef.current) return;
        const start = startRef.current || 0;
        const end = endRef.current || 0;
        const t = (e?.currentPosition || 0) / 1000;
        if (end > 0 && t >= end) {
          if (loopRef.current) {
            if (!rewindingRef.current) {
              rewindingRef.current = true;
              seekAbsolute(start);
              emitTime(0, true);
            }
          } else {
            emitTime(Math.max(0, t - start), true);
            try { widget.pause(); } catch { /* noop */ }
            endPlayback();
          }
          return;
        }
        if (t < start - 1) {
          // Playing well before the window: the seek to its start was dropped
          // (a widget can ignore a seek made before its audio loaded).
          if (!rewindingRef.current) {
            rewindingRef.current = true;
            seekAbsolute(start);
          }
          return;
        }
        rewindingRef.current = false;
        emitTime(Math.max(0, t - start));
      });

      // The track itself ran out (full-song mode, or a window reaching its end).
      widget.bind(events.FINISH, () => {
        if (cancelled || !mountedRef.current) return;
        if (!wantPlayingRef.current || endedRef.current) return;
        if (loopRef.current) {
          seekAbsolute(startRef.current || 0);
          emitTime(0, true);
          try { widget.play(); } catch { /* noop */ }
        } else {
          endPlayback();
        }
      });

      widget.bind(events.ERROR, () => {
        if (cancelled || !mountedRef.current) return;
        failed = true;
        clearTimeout(readyTimer);
        wantPlayingRef.current = false;
        setPlayerError(true);
        setPlaying(false);
      });
    }).catch(() => {
      if (cancelled || !mountedRef.current) return;
      clearTimeout(readyTimer);
      setPlayerError(true);
    });

    return () => {
      cancelled = true;
      clearTimeout(readyTimer);
      if (widget && events) {
        for (const name of ['READY', 'PLAY', 'PAUSE', 'PLAY_PROGRESS', 'FINISH', 'ERROR']) {
          try { widget.unbind(events[name]); } catch { /* noop */ }
        }
      }
      widgetRef.current = null;
      readyRef.current = false;
      try { host?.replaceChildren(); } catch { /* noop */ }
    };
    // Recreate only when the track changes; refs carry the latest window/cb.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [soundcloudUrl]);

  useImperativeHandle(ref, () => ({
    play: () => requestPlay(),
    pause: () => requestPause(),
    toggle: () => {
      if (playingRef.current) requestPause();
      else requestPlay();
    },
    seekTo: (s) => seekToWindowTime(s),
    getCurrentTime: () => currentTime,
    getDuration: () => duration,
    isPlaying: () => playingRef.current,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [currentTime, duration]);

  if (!soundcloudUrl) return null;

  // Runs inside the tap itself: mobile browsers only start audio from a
  // user gesture.
  const handleTapToPlay = () => requestPlay();
  return (
    <div className={`@container relative isolate w-full aspect-video overflow-hidden rounded-xl bg-black ring-1 ring-white/10 ${className}`}>
      {/* The widget iframe (audio engine): in the DOM, 1px, invisible. */}
      <div ref={hostRef} aria-hidden="true" className="absolute left-0 top-0 h-px w-px overflow-hidden opacity-0 pointer-events-none" />

      {artwork && (
        <img
          src={artwork}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full scale-125 object-cover blur-2xl brightness-50"
        />
      )}
      {artwork && (
        <div className="absolute inset-x-0 top-[9%] flex h-[58%] justify-center">
          <img
            src={artwork}
            alt={`${name} artwork`}
            className="aspect-square h-full rounded-md object-cover shadow-lg ring-1 ring-white/10"
          />
        </div>
      )}

      {showControls && !hasStarted && !playerError && (
        <TapToPlayOverlay onClick={handleTapToPlay} disabled={!isReady} />
      )}

      {/* Credit: title and uploader, and the official logo. Title and logo
          link to the track. Only the links take taps; the rest of the strip
          lets them through to the play overlay. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-end justify-between gap-3 bg-linear-to-t from-black/85 to-transparent px-3 pb-3 pt-8 @lg:gap-5 @lg:px-5 @lg:pb-5 @lg:pt-12">
        <div className="min-w-0 text-left">
          <a
            href={soundcloudUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="pointer-events-auto block truncate text-sm font-semibold text-white hover:underline @lg:text-xl"
          >
            {name}
          </a>
          <p className="truncate text-xs text-white/70 @lg:text-base">{artist}</p>
        </div>
        <a
          href={soundcloudUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Listen on SoundCloud"
          className="pointer-events-auto shrink-0 rounded-md bg-[#121212] px-2.5 py-2 @lg:px-3.5 @lg:py-2.5"
        >
          <img
            src={soundcloudLogo}
            alt="SoundCloud"
            width={200}
            height={24}
            className="block h-auto w-[100px] @lg:w-[150px]"
          />
        </a>
      </div>

      {playerError && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/80 px-6 text-center">
          <p className="text-sm text-red-300">
            This SoundCloud track cannot be played here. Pick another result.
          </p>
        </div>
      )}
    </div>
  );
});

export default SoundCloudPlayerWithRef;
export { SoundCloudPlayerWithRef };
