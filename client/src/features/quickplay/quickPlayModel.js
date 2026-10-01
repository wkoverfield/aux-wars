/**
 * Quick Play (public, hostless rooms): pure copy and timer helpers shared by
 * the homepage line, the waiting screen and the in-game timers. No React, so
 * every state is unit tested.
 *
 * Copy rule: no em dashes. "Label: description" form.
 */

/** Seats in a Quick Play room when the server does not say (rooms.playerCap). */
export const DEFAULT_QUICK_PLAY_CAP = 6;
/** Players needed before the start countdown arms (server: COUNTDOWN_MIN_PLAYERS). */
export const COUNTDOWN_MIN_PLAYERS = 3;

/** The homepage line under Join / Host. */
export function homeLineCopy({ waiting, joining }) {
  if (joining) return "Finding a game…";
  const n = typeof waiting === "number" && waiting > 0 ? Math.floor(waiting) : 0;
  if (n === 0) return "No friends? Quick Play: match with random players";
  return `No friends? Quick Play (${n} waiting)`;
}

/** Whole seconds left until `targetMs` (never negative; null when unset). */
export function secondsUntil(targetMs, nowMs) {
  if (typeof targetMs !== "number" || !Number.isFinite(targetMs)) return null;
  return Math.max(0, Math.ceil((targetMs - nowMs) / 1000));
}

/** 0..1 share of the countdown already elapsed, for the progress bar. */
export function countdownProgress(armedAt, startsAt, nowMs) {
  if (typeof armedAt !== "number" || typeof startsAt !== "number" || startsAt <= armedAt) return 0;
  return Math.min(1, Math.max(0, (nowMs - armedAt) / (startsAt - armedAt)));
}

/**
 * The waiting screen's status card.
 * `{ kind: "waiting" | "countdown", label, headline, helper, seconds?, progress? }`
 */
export function lobbyStatus({ count, cap = DEFAULT_QUICK_PLAY_CAP, startsAt, armedAt, nowMs }) {
  const seats = `${count}/${cap}`;
  if (typeof startsAt === "number") {
    return {
      kind: "countdown",
      label: "Starting in",
      seconds: secondsUntil(startsAt, nowMs),
      progress: countdownProgress(armedAt, startsAt, nowMs),
      headline: `${seats} players`,
      helper: "More players can still join until it starts.",
    };
  }
  return {
    kind: "waiting",
    label: "Status",
    headline: `Waiting for players (${seats})`,
    helper:
      count >= 2
        ? `The game starts at ${COUNTDOWN_MIN_PLAYERS}, or now if everyone votes.`
        : `Matching you with random players. The game starts at ${COUNTDOWN_MIN_PLAYERS}.`,
  };
}

/** "Start now" vote button: unanimous among everyone seated. */
export function startNowLabel({ votes, total, voted }) {
  return voted ? `Start now: voted (${votes}/${total})` : `Start now (${votes}/${total})`;
}

/** Anonymous kick tally, e.g. "2 of 3 votes to kick". */
export function kickTallyLabel(tally) {
  if (!tally || !(tally.votes > 0)) return null;
  return `${tally.votes} of ${tally.needed} ${tally.needed === 1 ? "vote" : "votes"} to kick`;
}

/** Tally for one player doc id from room.kickTallies. */
export function tallyFor(kickTallies, playerDocId) {
  return (kickTallies || []).find((t) => t.targetPlayerDocId === playerDocId) || null;
}

/** Results screen pill in a public room (replaces the host's Next Round button). */
export function autoAdvanceLabel({ seconds, isFinalRound }) {
  if (seconds === null) return null;
  return isFinalRound ? `Final results in ${seconds}s` : `Next round in ${seconds}s`;
}

/** A fresh seat key: the secret that proves this browser owns its seat on rejoin. */
export function makeSeatKey(cryptoImpl = globalThis.crypto) {
  const bytes = new Uint8Array(24);
  cryptoImpl.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Body for the pagehide beacon that releases a Quick Play seat when the tab
 * closes (POST {convexUrl}/api/mutation, the same channel presence uses for
 * its disconnect beacon). The server waits a few seconds and keeps the seat
 * if the player is back online, so a reload is not a leave.
 */
export function leaveBeaconBody({ code, playerId, connectionId }) {
  return JSON.stringify({
    path: "game/rooms:leaveGame",
    args: { code, playerId, connectionId, onClose: true },
    format: "json",
  });
}
