import { httpAction } from "./_generated/server";
import youtubesearchapi from "youtube-search-api";

export const youtubeSearch = httpAction(async (ctx, request) => {
  try {
    const { query } = await request.json();
    if (!query || typeof query !== "string" || query.trim().length < 2) {
      return new Response(JSON.stringify({ error: "Invalid query" }), { status: 400 });
    }

    const result = await youtubesearchapi.GetListByKeyword(
      `${query} music`,
      false,
      20,
      [{ type: "video" }]
    );

    const items = Array.isArray(result?.items) ? result.items : [];
    const tracks = items.map(transformToTrack).filter((t) => t !== null);

    return new Response(JSON.stringify({ tracks }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (_err) {
    return new Response(JSON.stringify({ error: "Search failed" }), { status: 500 });
  }
});

function transformToTrack(item: any) {
  if (!item || !item.id) return null;
  const thumbnailUrl =
    item.thumbnail?.url ||
    item.thumbnails?.[0]?.url ||
    item.thumbnails?.high?.url ||
    item.thumbnails?.medium?.url ||
    item.thumbnails?.default?.url ||
    `https://i.ytimg.com/vi/${item.id}/mqdefault.jpg`;

  return {
    id: item.id,
    name: decodeHTMLEntities(item.title),
    artists: [{ name: decodeHTMLEntities(item.channelTitle || "Unknown Artist") }],
    album: { name: "YouTube", images: [{ url: thumbnailUrl }] },
    preview_url: `https://www.youtube.com/embed/${item.id}`,
    external_url: `https://www.youtube.com/watch?v=${item.id}`,
  };
}

function decodeHTMLEntities(text: string) {
  if (!text) return text;
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#(\d+);/g, (_match, dec) => String.fromCharCode(dec))
    .replace(/&#x([a-fA-F0-9]+);/g, (_match, hex) => String.fromCharCode(parseInt(hex, 16)));
}



