import { forwardRef } from 'react';
import AudioPreviewPlayer from './AudioPreviewPlayer';
import SoundCloudPlayerWithRef from './SoundCloudPlayer';
import YouTubePlayerWithRef from './YouTubePlayer';

/**
 * TrackPlayer
 *
 * Source-agnostic player. A track has exactly one source:
 *   - `videoId`       → the YouTube IFrame player (full song → clip any window)
 *   - `soundcloudUrl` → the SoundCloud player (full track → clip any window)
 *   - `src`           → the HTML5 audio player for an iTunes/Deezer 30s preview
 * All three children expose the SAME imperative ref API + callbacks, so this
 * is the only place the source branch lives and callers (RatingScreen,
 * SnippetSelector, the Local Play screen) stay identical for any source.
 *
 * Ref API (all): play(), pause(), toggle(), seekTo(s), getCurrentTime(),
 * getDuration(), isPlaying(). Callbacks: onReady(len), onTimeUpdate(t), onEnded().
 *
 * `name`, `artist` and `artwork` are used by the SoundCloud player only: it
 * draws its own box and must credit the track (see SoundCloudPlayer.jsx).
 */
const TrackPlayer = forwardRef(function TrackPlayer(
  {
    videoId,
    soundcloudUrl,
    src,
    name,
    artist,
    artwork,
    startTime = 0,
    endTime = 0,
    autoPlay = false,
    loop = false,
    showControls = true,
    canPickAnother = false,
    onReady,
    onTimeUpdate,
    onEnded,
    onDuration,
    onPlayingChange,
    className = '',
  },
  ref
) {
  if (videoId) {
    return (
      <YouTubePlayerWithRef
        ref={ref}
        videoId={videoId}
        startTime={startTime}
        endTime={endTime}
        autoPlay={autoPlay}
        loop={loop}
        showControls={showControls}
        canPickAnother={canPickAnother}
        onReady={onReady}
        onTimeUpdate={onTimeUpdate}
        onEnded={onEnded}
        onDuration={onDuration}
        onPlayingChange={onPlayingChange}
        className={className}
      />
    );
  }

  if (soundcloudUrl) {
    return (
      <SoundCloudPlayerWithRef
        ref={ref}
        soundcloudUrl={soundcloudUrl}
        name={name}
        artist={artist}
        artwork={artwork}
        startTime={startTime}
        endTime={endTime}
        autoPlay={autoPlay}
        loop={loop}
        showControls={showControls}
        canPickAnother={canPickAnother}
        onReady={onReady}
        onTimeUpdate={onTimeUpdate}
        onEnded={onEnded}
        onDuration={onDuration}
        onPlayingChange={onPlayingChange}
        className={className}
      />
    );
  }

  return (
    <AudioPreviewPlayer
      ref={ref}
      src={src}
      autoPlay={autoPlay}
      loop={loop}
      showControls={showControls}
      onReady={onReady}
      onTimeUpdate={onTimeUpdate}
      onEnded={onEnded}
      onPlayingChange={onPlayingChange}
      className={className}
    />
  );
});

export default TrackPlayer;
