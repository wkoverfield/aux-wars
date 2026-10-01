# Convex conventions

Rules for writing Convex functions in this repo. Read this before adding any
query, mutation, or scheduled function that runs during an active game. Breaking
them does not fail a test, it silently multiplies function-call volume and
database I/O until the deployment exceeds its plan limits.

## Invalidation is document-level

Convex re-runs a subscribed query when any document that query read is written,
not when the specific field a query cares about changes. A `db.patch` on one
`rooms` or `players` document therefore re-runs *every* subscribed query that
touched that document, for *every* connected client, and each of those re-runs
is billed as a function call.

The blast radius multiplies: writes per second, times subscribed queries, times
clients in the room. A 5-second heartbeat in an 8-player room is on the order of
550k function calls per room-day on its own.

## Never put hot or heartbeat timestamps on game documents

`rooms` and `players` are read by nearly every gameplay query, so they are the
worst possible place for a frequently-written field. Do not add `lastSeen`,
`lastPing`, `lastActivity`-style fields that are refreshed on a timer.

Presence belongs to the `@convex-dev/presence` component, which keeps it in its
own sandboxed tables (see `convex/presence.ts`). Steady-state heartbeats there
write nothing, so they invalidate nothing. Only an actual online/offline
transition touches a document that a client query reads. Do not fold presence
data back into game documents for convenience.

## Store state transitions, not timestamps

Prefer a boolean or enum that a scheduled function flips once (`isOnline`,
`status: "ACTIVE" | "TAKEN_OVER"`) over a timestamp the client refreshes on an
interval. A transition writes on the rare event; a timestamp writes on every
tick.

Where a timestamp is genuinely needed, write it only on real user actions, not
on a timer. `rooms.lastActivityAt` is updated by gameplay actions and read by
the 24-hour stale-room cron; that is an acceptable write rate.

## Guard every write

Read before you patch and skip the write when nothing would change:

```ts
if (player.status === next) return; // no-op patch still invalidates
await ctx.db.patch(player._id, { status: next });
```

A patch that sets a field to the value it already holds still counts as a write
and still invalidates every subscriber.

## Keep hot queries keyed by room-only arguments

Convex caches a query execution per unique argument set. A query taking only
`{ roomCode }` is computed once and shared by every client in that room. Adding
a per-user argument, or reading `ctx.auth` inside the function, forks that into
one execution per client and multiplies the cost of every invalidation by the
player count.

If a client needs a user-specific slice of room state, prefer deriving it on the
client from the shared room-keyed query, or isolate it in a separate small query
that reads as few documents as possible.

## Scheduled timers must prove they are still current

A scheduled function cannot be cancelled by changing state, so every timer has
to check on arrival that the state it was armed for still holds. `(phase,
round)` alone is not enough: a game can be abandoned and relaunched, and the new
game reuses round 1.

- In-game timers (`endPromptVoting`, `endSelectionPhase`,
  `startRatingPhaseInternal`, `advanceRating`, `calculateResultsInternal`)
  carry the room's `gameEpoch`, which `launchFirstRound` bumps on every launch,
  and no-op on a mismatch (`isCurrentGame` in `convex/game/roomOps.ts`).
  Anything that schedules one of them passes `epoch: gameEpochOf(room)`.
- A timer that can be re-armed within one phase also carries the fire or start
  time it was armed with and no-ops unless the room still holds that value
  (`promptVotingStartedAt` for a prompt skip; `startsAt`, `oneVOneOfferAt`,
  `autoAdvanceAt` and `rematchStartingAt` for Quick Play and rematch timers).

## Seed and QA functions are internal, never public

Anything that writes fixture data, resets state, or exists only for testing must
be declared with `internalMutation` / `internalAction`. A public mutation is
callable by anyone who can reach the deployment.

## Typechecking

`convex/` has its own `convex/tsconfig.json` and is checked by `npm run
typecheck:convex`. Run it before committing changes under `convex/`. It exists
because untypechecked code shipped an always-true comparison between a branded
`Id` and a plain field, which made the cleanup cron silently double-assign
hosts.
