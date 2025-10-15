### Project context

- **App**: Aux Wars — a real-time party game where players join a lobby, submit songs to match a prompt, then rate and view round/game winners.
- **Stack**: React 19 + Vite, React Router 7, Tailwind 4. Migrating backend from Express + Socket.IO to Convex (reactive DB, queries/mutations/actions, schedulers, HTTP actions).
- **Convex usage**: Real-time room state, players, phases, submissions/ratings, scheduler-driven rating progression. Client uses `useQuery`, `useMutation`, and `useAction`.

### Migration status

- Client wraps in `ConvexProvider` and replaces Socket.IO flows with Convex queries/mutations. `RoomProvider` context supplies room/players.
- Routing/guards updated to rely on Convex state; lobby/round/results mostly wired to Convex.
- Convex schema extended (`rooms.currentRatingIndex`) and server logic updated to drive rating progression via scheduler and server-side auto-skip.
- HTTP action for YouTube search added at `/youtube/search` with OPTIONS handling and dynamic CORS headers.
- New Convex Action `youtube.search` added to avoid CORS entirely by using Convex’s WebSocket path.

### The specific blocker

- We want to keep using the `youtube-search-api` package (a no‑key abstraction over scraping YouTube results) for track search. Originally this ran in the old Express server without issues.
- We attempted two approaches:
  1) **HTTP action**: Client fetches `http://127.0.0.1:3210/youtube/search`. Despite adding `OPTIONS` route and echoing `Access-Control-Allow-Origin`, the browser still fails preflight with “No ‘Access-Control-Allow-Origin’” for some requests in dev.
  2) **Convex Action (`api.youtube.search`)**: Client calls via `useAction`, which avoids browser CORS. However, in the Convex runtime the import `youtube-search-api` is undefined, causing: “Cannot read properties of undefined (reading 'GetListByKeyword')”. Likely cause: the package is not available/compatible in Convex’s action bundling/runtime (Node APIs or ESM/CJS interop issues). We have not yet tried root-level install + dynamic import.

### Current code shape relevant to issue

- Client Round search currently calls the Convex Action via `useAction(api.youtube.search)` to bypass CORS.
- `convex/youtube.ts` contains both:
  - `youtubeSearch` HTTP action with CORS headers (POST and OPTIONS).
  - `search` Action that tries to call `youtube-search-api` and fails at runtime.
- There’s a legacy helper `client/src/services/serverYoutubeApi.js` that can call Express `/api/youtube/search`; when used, it works (proxy removes CORS in dev).

### Constraints and preferences

- Strong preference to continue using the `youtube-search-api` scraper abstraction over the official YouTube Data API.
- Willing to keep the older Express server just for search if needed, but would prefer a clean Convex-only solution if feasible.
- Not concerned about rollback; okay with a full switch-over and redeploy once done.

### Options considered and trade-offs

- **Use Convex Action + `youtube-search-api`** (ideal if feasible): Cleanest client experience (no CORS), but package might be incompatible with Convex’s runtime.
  - Potential fixes:
    - Install `youtube-search-api` at the repo root (not inside `client/`), then dynamic import in the action:
      - `const ysa = (await import('youtube-search-api')).default ?? (await import('youtube-search-api'));`
      - Verify `ysa.GetListByKeyword` is a function; otherwise the package likely can’t run in Convex (Node APIs not available).

- **Keep Express for search** (pragmatic, works now): Retain `/api/youtube/search` in `server/server.js`, call it from client using Vite proxy (`/api`) in dev and `VITE_SERVER_URL` in prod.
  - Pros: works today, no CORS, preserves scraper. Cons: two backends (Convex + Express).

- **Convex Action proxies to Express**: Convex does server-to-server HTTP to Express, returns tracks to client.
  - Avoids browser CORS, but adds coupling and requires public Express URL in prod.

- **HTTP Action only**: Persist with `/youtube/search` and fix CORS. Already echoing origin and handling preflight; dev has been flaky and time-consuming.

### What we want insight on

- The feasibility of using `youtube-search-api` inside Convex Actions:
  - Whether Convex Actions can run packages that do headless scraping or rely on Node-specific modules.
  - If so, what exact install/import pattern is required (root install, dynamic import, ESM/CJS interop).
- If Convex is unsuitable for this package, best practice for splitting concerns (keep scraping in Express with Vite proxy in dev; use a hosted endpoint in prod), while the rest of the app uses Convex.
- Any reliable pattern to make Convex HTTP actions’ CORS work flawlessly in dev for POST with JSON body, beyond echoing `Access-Control-Allow-Origin` and handling OPTIONS.

### Files of interest

- `convex/youtube.ts`: defines both HTTP action and Convex Action for search.
- `client/src/features/round/Round.jsx`: currently using `useAction(api.youtube.search)`.
- `client/src/services/serverYoutubeApi.js`: the old fetch helper to Express endpoint (works).
- `client/vite.config.js`: has aliases and server config; can add proxy for `/api -> http://localhost:3001`.

### Environment

- Dev URLs: client `http://localhost:5174`, Convex dev server `http://127.0.0.1:3210`, Express `http://localhost:3001`.
- Monorepo layout: `client/`, `convex/`, `server/`. Convex codegen `_generated/api` used in client via alias `@convex`.

In short: the app has migrated to Convex for real-time game logic, but YouTube search is blocked. The “ideal” path is Convex Action with the scraping package; it’s failing due to runtime/package limitations. The pragmatic path is to keep the Express endpoint with a Vite dev proxy to avoid CORS and call that from the client. We’re looking for guidance on making the Convex Action work with `youtube-search-api`, or a clean justification for keeping Express for this one concern.


