import { describe, expect, it, vi } from "vitest";
import {
  autoAdvanceLabel,
  countdownProgress,
  homeLineCopy,
  kickTallyLabel,
  leaveBeaconBody,
  lobbyStatus,
  makeSeatKey,
  secondsUntil,
  startNowLabel,
  tallyFor,
} from "./quickPlayModel";
import { sendLeaveBeacon } from "./useQuickPlay";

const readBlob = (blob) =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsText(blob);
  });

const EM_DASH = "\u2014";

describe("homepage line", () => {
  it("reads as an open match queue when nobody is waiting", () => {
    expect(homeLineCopy({ waiting: 0 })).toBe("No friends? Quick Play: match with random players");
    expect(homeLineCopy({ waiting: undefined })).toBe("No friends? Quick Play: match with random players");
  });

  it("shows the live count when players are waiting", () => {
    expect(homeLineCopy({ waiting: 3 })).toBe("No friends? Quick Play (3 waiting)");
    expect(homeLineCopy({ waiting: 1 })).toBe("No friends? Quick Play (1 waiting)");
  });

  it("switches to the joining state while the seat is being found", () => {
    expect(homeLineCopy({ waiting: 3, joining: true })).toBe("Finding a game…");
  });
});

describe("timers", () => {
  it("rounds seconds up and never goes negative", () => {
    expect(secondsUntil(10_500, 0)).toBe(11);
    expect(secondsUntil(10_000, 0)).toBe(10);
    expect(secondsUntil(1_000, 5_000)).toBe(0);
    expect(secondsUntil(undefined, 0)).toBeNull();
  });

  it("reports countdown progress between arming and start", () => {
    expect(countdownProgress(0, 30_000, 0)).toBe(0);
    expect(countdownProgress(0, 30_000, 15_000)).toBe(0.5);
    expect(countdownProgress(0, 30_000, 45_000)).toBe(1);
    expect(countdownProgress(undefined, 30_000, 1_000)).toBe(0);
  });

  it("labels the results timer by round", () => {
    expect(autoAdvanceLabel({ seconds: 6, isFinalRound: false })).toBe("Next round in 6s");
    expect(autoAdvanceLabel({ seconds: 6, isFinalRound: true })).toBe("Final results in 6s");
    expect(autoAdvanceLabel({ seconds: null, isFinalRound: false })).toBeNull();
  });
});

describe("waiting screen status", () => {
  it("explains the queue when alone and the vote with two", () => {
    expect(lobbyStatus({ count: 1, cap: 6, nowMs: 0 })).toMatchObject({
      kind: "waiting",
      headline: "Waiting for players (1/6)",
      helper: "Matching you with random players. The game starts at 3.",
    });
    expect(lobbyStatus({ count: 2, cap: 6, nowMs: 0 }).helper).toBe(
      "The game starts at 3, or now if everyone votes."
    );
  });

  it("becomes a countdown with a progress bar once armed", () => {
    const s = lobbyStatus({ count: 3, cap: 6, armedAt: 0, startsAt: 30_000, nowMs: 6_000 });
    expect(s).toMatchObject({ kind: "countdown", label: "Starting in", seconds: 24, headline: "3/6 players" });
    expect(s.progress).toBeCloseTo(0.2);
  });

  it("labels the Start now vote", () => {
    expect(startNowLabel({ votes: 0, total: 2, voted: false })).toBe("Start now (0/2)");
    expect(startNowLabel({ votes: 1, total: 3, voted: true })).toBe("Start now: voted (1/3)");
  });
});

describe("anonymous kick tally", () => {
  it("shows only a count, never who voted", () => {
    expect(kickTallyLabel({ targetPlayerDocId: "a", votes: 2, needed: 3 })).toBe("2 of 3 votes to kick");
    expect(kickTallyLabel({ votes: 1, needed: 1 })).toBe("1 of 1 vote to kick");
    expect(kickTallyLabel({ votes: 0, needed: 2 })).toBeNull();
    expect(kickTallyLabel(null)).toBeNull();
  });

  it("finds a player's tally by doc id", () => {
    const tallies = [{ targetPlayerDocId: "a", votes: 1, needed: 2 }];
    expect(tallyFor(tallies, "a")).toEqual(tallies[0]);
    expect(tallyFor(tallies, "b")).toBeNull();
    expect(tallyFor(undefined, "a")).toBeNull();
  });
});

describe("copy rule", () => {
  it("uses no em dashes in any state", () => {
    const all = [
      homeLineCopy({ waiting: 0 }),
      homeLineCopy({ waiting: 4 }),
      homeLineCopy({ joining: true }),
      ...Object.values(lobbyStatus({ count: 1, nowMs: 0 })),
      ...Object.values(lobbyStatus({ count: 4, armedAt: 0, startsAt: 30_000, nowMs: 0 })),
      startNowLabel({ votes: 1, total: 2, voted: true }),
      kickTallyLabel({ votes: 1, needed: 2 }),
      autoAdvanceLabel({ seconds: 3, isFinalRound: true }),
    ].map(String);
    for (const text of all) expect(text).not.toContain(EM_DASH);
  });
});

describe("seat key and leave beacon", () => {
  it("makes a long random hex seat key", () => {
    const a = makeSeatKey();
    expect(a).toMatch(/^[0-9a-f]{48}$/);
    expect(makeSeatKey()).not.toBe(a);
  });

  it("beacons leaveGame with onClose to the Convex mutation endpoint", async () => {
    const sendBeacon = vi.fn(() => true);
    const ok = sendLeaveBeacon({
      convexUrl: "https://example.convex.cloud",
      code: "QAAAAA",
      playerId: "p1",
      connectionId: "c1",
      nav: { sendBeacon },
    });
    expect(ok).toBe(true);
    const [url, blob] = sendBeacon.mock.calls[0];
    expect(url).toBe("https://example.convex.cloud/api/mutation");
    const body = JSON.parse(await readBlob(blob));
    expect(body).toEqual(JSON.parse(leaveBeaconBody({ code: "QAAAAA", playerId: "p1", connectionId: "c1" })));
    expect(body).toMatchObject({
      path: "game/rooms:leaveGame",
      args: { code: "QAAAAA", playerId: "p1", connectionId: "c1", onClose: true },
    });
  });

  it("skips the beacon without a deployment URL or seat", () => {
    const sendBeacon = vi.fn();
    expect(sendLeaveBeacon({ convexUrl: "", code: "Q", playerId: "p", connectionId: "c", nav: { sendBeacon } })).toBe(false);
    expect(sendLeaveBeacon({ convexUrl: "u", code: "Q", playerId: "", connectionId: "c", nav: { sendBeacon } })).toBe(false);
    expect(sendBeacon).not.toHaveBeenCalled();
  });
});

describe("useLeaveOnClose", () => {
  it("resumes the seat on mount and on a back/forward cache restore, and beacons on pagehide", async () => {
    const { renderHook } = await import("@testing-library/react");
    const { useLeaveOnClose } = await import("./useQuickPlay");
    const resume = vi.fn(() => Promise.resolve());
    const sendBeacon = vi.fn(() => true);
    const original = navigator.sendBeacon;
    navigator.sendBeacon = sendBeacon;
    const { unmount } = renderHook(() =>
      useLeaveOnClose({ enabled: true, code: "QAAAAA", playerId: "p1", connectionId: "c1", resume })
    );
    expect(resume).toHaveBeenCalledWith({ code: "QAAAAA", playerId: "p1", connectionId: "c1" });
    const pageshow = new Event("pageshow");
    pageshow.persisted = true;
    window.dispatchEvent(pageshow);
    expect(resume).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event("pagehide"));
    // jsdom has no deployment URL in tests; the beacon is skipped rather than thrown.
    unmount();
    window.dispatchEvent(new Event("pagehide"));
    navigator.sendBeacon = original;
  });

  it("does nothing for private rooms", async () => {
    const { renderHook } = await import("@testing-library/react");
    const { useLeaveOnClose } = await import("./useQuickPlay");
    const resume = vi.fn();
    renderHook(() => useLeaveOnClose({ enabled: false, code: "QAAAAA", playerId: "p1", connectionId: "c1", resume }));
    expect(resume).not.toHaveBeenCalled();
  });
});
