# YouTube Search Architecture - Final Decision

## Context

Aux Wars is a real-time party game where players search for songs to match prompts. We needed a YouTube search solution that:
1. Works without requiring users to get YouTube API keys
2. Avoids CORS issues when calling from the browser
3. Integrates cleanly with our Convex-based real-time backend

## Attempts to Use Convex

### Attempt 1: Regular Convex Action
**Goal:** Use Convex Action to call `youtube-search-api` package

**Implementation:**
```typescript
import { action } from "./_generated/server";
import youtubesearchapi from "youtube-search-api";

export const search = action({
  args: { query: v.string() },
  handler: async (_ctx, { query }) => {
    const result = await youtubesearchapi.GetListByKeyword(...);
    // ...
  }
});
```

**Result:** ❌ FAILED
```
Error: Cannot read properties of undefined (reading 'GetListByKeyword')
```

**Cause:** Package `youtube-search-api` resolved as `undefined` in Convex runtime. The package likely uses Node.js APIs or module resolution patterns incompatible with Convex's environment.

---

### Attempt 2: Convex Action with Node.js Runtime
**Goal:** Use `"use node"` directive to access Node.js APIs

**Implementation:**
```typescript
"use node";

import { httpAction, action } from "./_generated/server";
import youtubesearchapi from "youtube-search-api";
```

**Result:** ❌ FAILED (Two issues)

**Issue 1:** HTTP Actions incompatible with Node runtime
```
Error: `youtubeSearch` defined in `youtube.js` is a HttpAction function.
Only actions can be defined in Node.js.
```

**Resolution:** Removed HTTP Action, kept only regular Action

**Issue 2:** Package still undefined
```
Error: Cannot read properties of undefined (reading 'GetListByKeyword')
```

**Cause:** Even with Node.js runtime, `youtube-search-api` package remained undefined. Convex's Node.js environment is sandboxed and doesn't support all Node packages.

---

## Final Solution: Express Server

### Architecture Decision

**Use a dedicated Express server for YouTube search**, separate from Convex.

### Why This Is the Right Approach

#### 1. **Package Compatibility**
- `youtube-search-api` works perfectly in standard Node.js/Express
- No module resolution issues
- Full access to Node.js APIs needed for web scraping

#### 2. **Clear Separation of Concerns**
- **Convex:** Real-time game logic (rooms, players, submissions, ratings, results)
- **Express:** External API scraping (YouTube search only)
- Each system does what it's best at

#### 3. **Reliability**
- Express endpoint has been tested and works consistently
- No CORS issues (handled server-side)
- Client-side caching in `serverYoutubeApi.js` improves performance

#### 4. **Minimal Overhead**
- Express server is now single-purpose (just YouTube search)
- Removed all Socket.IO code (migrated to Convex)
- ~150 lines of code for entire server
- Clean, maintainable, well-documented

### Current Implementation

**Express Server** (`server/server.js`):
```javascript
// Single endpoint: POST /api/youtube/search
app.post('/api/youtube/search', async (req, res) => {
  const result = await youtubesearchapi.GetListByKeyword(
    `${query} music`, false, 20, [{type: "video"}]
  );
  res.json({ tracks: transformedResults });
});
```

**Client Wrapper** (`client/src/services/serverYoutubeApi.js`):
- Calls Express endpoint via Vite proxy in dev (`/api` → `http://localhost:3001`)
- Calls direct URL in production (`VITE_SERVER_URL`)
- 5-minute client-side cache
- Request deduplication
- Graceful error handling with stale cache fallback

**Development:**
- Vite proxy: `/api/*` → `http://localhost:3001/*`
- No CORS issues
- Hot reload works

**Production:**
- Express deployed to Railway
- Client deployed to Vercel
- Environment variable: `VITE_SERVER_URL=https://aux-wars-server.railway.app`

---

## Lessons Learned

### When to Use Convex
✅ Real-time state synchronization
✅ Database queries and mutations
✅ Scheduled tasks
✅ Standard fetch calls to public APIs

### When NOT to Use Convex
❌ Packages that require full Node.js environment
❌ Web scraping libraries
❌ Packages with complex module resolution
❌ Legacy CommonJS packages with unusual exports

### Two-Backend Architecture Is OK
Having Express + Convex is **not an anti-pattern** when:
- Each serves a clear, distinct purpose
- The separation makes the code cleaner
- Attempting to merge them creates more complexity than it solves

---

## Alternatives Considered

### Option 1: YouTube Data API v3
**Pros:**
- Official Google API
- Would work in Convex Actions (simple fetch)
- Well-documented

**Cons:**
- Requires API key (friction for users)
- Daily quota limits (10,000 units/day)
- 100 units per search = only 100 searches/day
- Overkill for simple search

**Decision:** ❌ Not worth the complexity

---

### Option 2: Different Scraping Library
**Examples:** `youtube-search-without-api-key`, `aiotube`, etc.

**Pros:**
- Might have better Convex compatibility

**Cons:**
- Would need to test each one
- No guarantee of Convex compatibility
- `youtube-search-api` already works perfectly in Express

**Decision:** ❌ Not worth the effort when Express works

---

### Option 3: Hybrid Convex Action → Express Proxy
**Implementation:**
```typescript
// Convex Action calls Express server-to-server
export const search = action({
  handler: async (_, { query }) => {
    const response = await fetch('http://localhost:3001/api/youtube/search', {
      method: 'POST',
      body: JSON.stringify({ query })
    });
    return response.json();
  }
});
```

**Pros:**
- Client calls Convex (no CORS)
- Convex proxies to Express

**Cons:**
- Adds unnecessary hop (Client → Convex → Express)
- Requires public Express URL accessible from Convex
- More complex deployment
- No real benefit over client calling Express directly

**Decision:** ❌ Overengineered

---

## Final Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    CLIENT BROWSER                       │
│  ┌──────────────────────────────────────────────────┐  │
│  │  React App (http://localhost:5174)              │  │
│  └──────────────────────────────────────────────────┘  │
│           │                              │              │
│           │ YouTube Search               │ Game Logic  │
│           ▼                              ▼              │
└───────────────────────────────────────────────────────┘
            │                              │
            │                              │
    ┌───────▼──────────┐        ┌─────────▼─────────┐
    │  Express Server  │        │  Convex Backend   │
    │  (port 3001)     │        │  (port 3210)      │
    │                  │        │                   │
    │  YouTube Search  │        │  Real-time Game   │
    │  Proxy Only      │        │  Logic & State    │
    │                  │        │                   │
    │  - CORS bypass   │        │  - Rooms          │
    │  - Scraping pkg  │        │  - Players        │
    │  - Transform     │        │  - Submissions    │
    │                  │        │  - Ratings        │
    └──────────────────┘        │  - Results        │
                                │  - Scheduler      │
                                └───────────────────┘
```

---

## Deployment

### Express (Railway)
- **Service:** YouTube Search Proxy
- **Port:** 3001
- **URL:** `https://aux-wars-server.railway.app`
- **Environment:** Production

### Convex (Convex Cloud)
- **Service:** Real-time game backend
- **URL:** Auto-managed by Convex
- **Environment:** Production

### Client (Vercel)
- **Service:** React frontend
- **URL:** `https://aux-wars.com`
- **Environment Variables:**
  - `VITE_SERVER_URL`: Points to Railway Express server
  - `VITE_CONVEX_URL`: Points to Convex deployment

---

## Conclusion

After thorough testing, **the Express + Convex architecture is the correct solution** for Aux Wars. Each backend serves its purpose cleanly:

- **Express:** Handles YouTube search scraping with `youtube-search-api`
- **Convex:** Handles real-time game state with reactive queries

This isn't a compromise—it's good architecture. The separation makes the codebase clearer, more maintainable, and more reliable than forcing everything into a single backend would be.

**Status:** ✅ RESOLVED - Express is the intentional, documented solution.
