# Music Search Architecture

## Context

Aux Wars is a real-time party game where players search for songs to match prompts,
then everyone listens to ~30s clips and rates them. We need song search + playback that:

1. Works without users supplying any API key or logging in
2. Avoids CORS issues when called from the browser
3. Lets us run our own ads without violating a music platform's ToS
4. Doesn't inject a platform's own ads into snippet playback

## Current solution: iTunes Search API + Deezer (30s previews)

Playback is a plain HTML5 `<audio>` element pointed at a 30-second preview clip.
Search runs server-side through the Express proxy, which queries two free, no-key
sources in parallel and merges them:

- **iTunes Search API** — `https://itunes.apple.com/search?term=&media=music&entity=song`
- **Deezer** — `https://api.deezer.com/search?q=`

Results are de-duplicated by normalized `name|artist`, results without a preview are
dropped, and the merged list is returned in the app's track shape:

```
{ id, name, artists:[{name}], album:{name, images:[{url}]}, preview_url, duration_ms, external_url }
```

`preview_url` is a direct audio clip URL (not an embed). The client stores it in
`submissions.trackDetails.previewUrl` (Convex), and `RatingScreen` / `SnippetSelector`
play it via `AudioPreviewPlayer`.

### Why not the official YouTube Data API?

- **Quota:** 10,000 units/day, and `search.list` costs 100 units → ~100 searches/day.
  We do thousands of searches/month; the default quota is unusable and a quota
  increase requires a ToS-compliance audit.
- **YouTube's own ads:** embedded monetized videos play YouTube's pre-roll ads on
  every snippet — terrible UX for a 30s clip, and we don't get that revenue.
- **Ad ToS:** running our own ads next to embedded YouTube content violates the
  YouTube API Services ToS.

### Tradeoffs of the preview approach

- Catalog is "officially released" music. Live-tested coverage is ~95% of normal
  picks (incl. sped-up versions). Gaps: viral/UGC/bootleg/meme audio.
- Search is name/artist based, not vibe-description based.
- No "pick your own 30s window" — the preview clip is the snippet (`snippet` is null).
- Gains: no platform pre-roll ads, faster loads, reliable mobile autoplay, and we can
  run our own ads on non-playback screens without ToS risk.

## Architecture

```
Client (React) ──search──▶ Express proxy ──▶ iTunes + Deezer
            └──game state──▶ Convex (rooms, players, submissions, ratings, results)
Playback: HTML5 <audio src={preview_url}> via AudioPreviewPlayer
```

- **Express** (`server/server.js`): `POST /api/music/search` (alias `/api/youtube/search`
  kept for rollout safety). Deployed to Railway.
- **Convex**: real-time game logic. Deployed to Convex Cloud.
- **Client**: React on Vercel. Env: `VITE_SERVER_URL`, `VITE_CONVEX_URL`.
