import React, { forwardRef } from 'react';
import AudioPreviewPlayer from './AudioPreviewPlayer';
import YouTubePlayerWithRef from './YouTubePlayer';

/**
 * TrackPlayer
 *
 * Source-agnostic player: renders the YouTube IFrame player when the track has
 * a `videoId` (full song → clip any window), otherwise the HTML5 audio player
 * for an iTunes/Deezer 30s preview. Both children expose the SAME imperative
 * ref API + callbacks, so this is the only place the source branch lives and
 * callers (RatingScreen, SnippetSelector) stay identical for either source.
 *
 * Ref API (both): play(), pause(), toggle(), seekTo(s), getCurrentTime(),
 * getDuration(), isPlaying(). Callbacks: onReady(len), onTimeUpdate(t), onEnded().
 */
const TrackPlayer = forwardRef(function TrackPlayer(
  {
    videoId,
    src,
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
        onReady={onReady}
        onTimeUpdate={onTimeUpdate}
        onEnded={onEnded}
        onDuration={onDuration}
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
      className={className}
    />
  );
});

export default TrackPlayer;
