const YOUTUBE_ART = /^https:\/\/i\.ytimg\.com\/vi\/([^/]+)\/[^/?]+\.jpg/;

/**
 * A sharper version of a YouTube thumbnail for large displays. hq720 is
 * 1280x720 with no letterboxing (hqdefault is 4:3 with black bars). Other
 * art (iTunes, Deezer) is returned unchanged. Not every video has hq720, so
 * callers fall back to the original URL on load error.
 */
export function largeCoverArt(url) {
  const match = typeof url === "string" ? url.match(YOUTUBE_ART) : null;
  return match ? `https://i.ytimg.com/vi/${match[1]}/hq720.jpg` : url;
}

/** onError handler: swap back to the original URL once, then stop. */
export function fallBackToOriginal(original) {
  return (event) => {
    const img = event.currentTarget;
    if (original && img.src !== original) img.src = original;
  };
}
