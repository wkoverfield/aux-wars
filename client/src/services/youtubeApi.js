/**
 * YouTube API service for searching music and managing playback
 * Replaces Spotify API functionality without requiring user authentication
 */

/**
 * Searches YouTube for music videos
 * @param {string} query - Search query
 * @returns {Promise<Array>} Array of video objects or error object
 */
export async function searchYouTubeMusic(query) {
  const apiKey = import.meta.env.VITE_YOUTUBE_API_KEY;
  
  if (!apiKey) {
    console.error("No YouTube API key configured");
    return { error: "missing_api_key", message: "YouTube API key not configured" };
  }

  if (!query || query.trim().length === 0) {
    return [];
  }

  try {
    // Add "music" to improve music-related results
    const searchQuery = `${query} music`;
    
    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/search?` +
      `part=snippet` +
      `&q=${encodeURIComponent(searchQuery)}` +
      `&type=video` +
      `&videoCategoryId=10` + // Music category
      `&maxResults=20` +
      `&key=${apiKey}`
    );

    if (!response.ok) {
      console.error(`YouTube API error: ${response.status} ${response.statusText}`);
      
      if (response.status === 403) {
        return { error: "quota_exceeded", message: "YouTube API quota exceeded" };
      } else if (response.status === 400) {
        return { error: "invalid_request", message: "Invalid search request" };
      }
      
      return { error: "api_error", status: response.status };
    }

    const data = await response.json();
    
    if (!data.items) {
      console.warn("No items in YouTube response");
      return [];
    }

    // Transform YouTube data to match our app's expected format
    const tracks = data.items.map(item => ({
      id: item.id.videoId,
      name: cleanVideoTitle(item.snippet.title),
      artists: [{ name: item.snippet.channelTitle }],
      album: {
        name: "YouTube",
        images: [
          { url: item.snippet.thumbnails.high?.url || item.snippet.thumbnails.default?.url }
        ]
      },
      preview_url: `https://www.youtube.com/embed/${item.id.videoId}`,
      duration_ms: 0, // Duration not available in search results
      external_url: `https://www.youtube.com/watch?v=${item.id.videoId}`
    }));

    console.log(`Found ${tracks.length} tracks for query: "${query}"`);
    return tracks;

  } catch (err) {
    console.error("YouTube search failed with exception:", err);
    return { error: "network_error", message: err.message };
  }
}

/**
 * Cleans up YouTube video titles to extract song information
 * @param {string} title - Raw YouTube video title
 * @returns {string} Cleaned title
 */
function cleanVideoTitle(title) {
  // Remove common YouTube title artifacts
  let cleaned = title
    .replace(/\(Official\s*(Video|Audio|Music\s*Video|Lyric\s*Video|Visualizer)\)/gi, '')
    .replace(/\[Official\s*(Video|Audio|Music\s*Video|Lyric\s*Video|Visualizer)\]/gi, '')
    .replace(/Official\s*(Video|Audio|Music\s*Video|Lyric\s*Video|Visualizer)/gi, '')
    .replace(/\((Audio|Lyrics?|HD|HQ|4K|Explicit)\)/gi, '')
    .replace(/\[(Audio|Lyrics?|HD|HQ|4K|Explicit)\]/gi, '')
    .replace(/\s*-\s*$/, '') // Remove trailing dash
    .replace(/\s+/g, ' ') // Multiple spaces to single
    .trim();
  
  return cleaned;
}

/**
 * Gets detailed information about a YouTube video
 * @param {string} videoId - YouTube video ID
 * @returns {Promise<Object>} Video details or error object
 */
export async function getYouTubeVideoDetails(videoId) {
  const apiKey = import.meta.env.VITE_YOUTUBE_API_KEY;
  
  if (!apiKey) {
    console.error("No YouTube API key configured");
    return { error: "missing_api_key" };
  }

  try {
    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?` +
      `part=snippet,contentDetails` +
      `&id=${videoId}` +
      `&key=${apiKey}`
    );

    if (!response.ok) {
      console.error(`YouTube API error: ${response.status}`);
      return { error: "api_error", status: response.status };
    }

    const data = await response.json();
    
    if (!data.items || data.items.length === 0) {
      return { error: "video_not_found" };
    }

    const video = data.items[0];
    return {
      id: video.id,
      title: cleanVideoTitle(video.snippet.title),
      channel: video.snippet.channelTitle,
      thumbnail: video.snippet.thumbnails.high?.url || video.snippet.thumbnails.default?.url,
      duration: parseDuration(video.contentDetails.duration),
      description: video.snippet.description
    };

  } catch (err) {
    console.error("Failed to get video details:", err);
    return { error: "network_error", message: err.message };
  }
}

/**
 * Parses ISO 8601 duration to seconds
 * @param {string} duration - ISO 8601 duration string (e.g., "PT4M13S")
 * @returns {number} Duration in seconds
 */
function parseDuration(duration) {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  
  const [, hours, minutes, seconds] = match;
  return (parseInt(hours || 0) * 3600) + (parseInt(minutes || 0) * 60) + parseInt(seconds || 0);
}

/**
 * Validates if a string is a valid YouTube URL and extracts video ID
 * @param {string} url - URL to validate
 * @returns {Object} Object with isValid boolean and videoId if valid
 */
export function parseYouTubeUrl(url) {
  const patterns = [
    /^https?:\/\/(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
    /^https?:\/\/(?:www\.)?youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /^https?:\/\/(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) {
      return { isValid: true, videoId: match[1] };
    }
  }

  return { isValid: false, videoId: null };
}

/**
 * No authentication required for YouTube embeds
 * This is a placeholder to match the Spotify API interface
 */
export function isTokenValid() {
  return true;
}

/**
 * No token debug info needed for YouTube
 */
export function getTokenDebugInfo() {
  return {
    authenticated: true,
    service: "YouTube",
    requiresUserAuth: false
  };
}