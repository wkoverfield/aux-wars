import React, { useEffect, useRef, useState } from 'react';

/**
 * YouTubePlayer component for embedding and controlling YouTube videos
 * Replaces Spotify Web Playback SDK functionality
 */
function YouTubePlayer({ videoId, autoplay = false, onReady, onStateChange }) {
  const playerRef = useRef(null);
  const [player, setPlayer] = useState(null);
  const [isReady, setIsReady] = useState(false);
  const [playerId] = useState(() => `youtube-player-${Math.random().toString(36).substr(2, 9)}`);

  // Load YouTube IFrame API
  useEffect(() => {
    // Check if API is already loaded
    if (window.YT && window.YT.Player) {
      initializePlayer();
      return;
    }

    // Load the IFrame Player API code asynchronously
    const tag = document.createElement('script');
    tag.src = "https://www.youtube.com/iframe_api";
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

    // YouTube API will call this function when ready
    window.onYouTubeIframeAPIReady = () => {
      initializePlayer();
    };

    return () => {
      if (player) {
        player.destroy();
      }
    };
  }, []);

  // Initialize player when API is ready
  const initializePlayer = () => {
    if (!playerRef.current || !window.YT || !window.YT.Player) {
      console.log('YouTube API not ready yet');
      return;
    }

    try {
      const newPlayer = new window.YT.Player(playerRef.current, {
        width: '100%',
        height: '100%',
        videoId: videoId,
        playerVars: {
          autoplay: autoplay ? 1 : 0,
          controls: 1,
          modestbranding: 1,
          rel: 0,
          showinfo: 0,
          fs: 1,
          playsinline: 1
        },
        events: {
          onReady: (event) => {
            setIsReady(true);
            setPlayer(event.target);
            if (onReady) onReady(event);
          },
          onStateChange: (event) => {
            if (onStateChange) onStateChange(event);
          },
          onError: (event) => {
            console.error('YouTube Player error:', event);
          }
        }
      });
    } catch (error) {
      console.error('Error initializing YouTube player:', error);
    }
  };

  // Update video when videoId changes
  useEffect(() => {
    if (player && isReady && videoId) {
      player.loadVideoById(videoId);
    }
  }, [videoId, player, isReady]);

  // Public methods
  const play = () => {
    if (player && isReady) {
      player.playVideo();
    }
  };

  const pause = () => {
    if (player && isReady) {
      player.pauseVideo();
    }
  };

  const stop = () => {
    if (player && isReady) {
      player.stopVideo();
    }
  };

  const setVolume = (volume) => {
    if (player && isReady) {
      player.setVolume(volume * 100); // Convert 0-1 to 0-100
    }
  };

  // Methods are exposed through the component instance
  // No ref needed for basic usage

  return (
    <div className="youtube-player-container w-full h-full">
      <div ref={playerRef} id={playerId} />
    </div>
  );
}

// Default export
export default YouTubePlayer;

/**
 * Hidden YouTube player for background playback
 * Similar to how Spotify playback was handled
 */
export function HiddenYouTubePlayer({ videoId, onReady, onStateChange }) {
  return (
    <div style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px' }}>
      <YouTubePlayer 
        videoId={videoId}
        autoplay={true}
        onReady={onReady}
        onStateChange={onStateChange}
      />
    </div>
  );
}