# PostHog post-wizard report

The wizard has completed a PostHog integration for the Aux Wars Express music search server (`server/`). The Express server is the only Node.js instrumentation target — all game logic lives in Convex (TypeScript) which already has a custom internal analytics system. PostHog is now layered on top of the Express music search proxy to give you real-time, cross-session visibility into catalog health and search patterns.

**Files changed:**

| File | Change |
|------|--------|
| `server/server.js` | Added `posthog-node` client initialization with `enableExceptionAutocapture: true`; added `music_searched`, `music_search_no_results` captures in `handleSearch`; added `captureException` in the error handler; added `X-POSTHOG-DISTINCT-ID` to CORS `allowedHeaders` |
| `server/index.js` | Imported `posthog` and added `await posthog.shutdown()` in the `SIGTERM` handler for clean flush on deploy/restart |
| `client/src/services/musicSearch.js` | Added `X-POSTHOG-DISTINCT-ID` header forwarding the persistent visitor ID so server-side events correlate with the same anonymous identity used by the Convex analytics system |
| Railway environment | Configure `POSTHOG_PROJECT_TOKEN` and `POSTHOG_HOST`; do not commit local env files |

## Events

| Event | Description | File |
|-------|-------------|------|
| `music_searched` | Fires after every successful search. Properties: `source` (`youtube` or `itunes_deezer_fallback`), `result_count`, `query_length`. | `server/server.js` |
| `music_search_no_results` | Fires when all sources (YouTube + iTunes + Deezer) return zero tracks. Properties: `query_length`. | `server/server.js` |
| `music_search_error` | Captured as an exception via `captureException` when the handler throws an unhandled error. Includes stack trace. | `server/server.js` |

## Next steps

We've built a dashboard and four insights for you to keep an eye on music search health:

- **Dashboard:** [Analytics basics (wizard)](https://us.posthog.com/project/349351/dashboard/1715355)
- **Music searches over time:** [41KJzKns](https://us.posthog.com/project/349351/insights/41KJzKns) — total daily search volume
- **Search source breakdown:** [g4SKKEpd](https://us.posthog.com/project/349351/insights/g4SKKEpd) — YouTube vs iTunes/Deezer fallback trend
- **Zero-result searches over time:** [9gHIsMWY](https://us.posthog.com/project/349351/insights/9gHIsMWY) — daily catalog gap signal
- **No-result rate:** [wE62zUXw](https://us.posthog.com/project/349351/insights/wE62zUXw) — `no_results / total_searches × 100` (watch for spikes when YouTube scraper breaks)

### Agent skill

We've left an agent skill folder in your project at `.claude/skills/integration-javascript_node/`. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.
