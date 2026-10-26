import { describe, expect, it, vi } from "vitest";
import {
  joinSourceFrom,
  phoneAudioKey,
  pickStatus,
  ratingVotes,
  readSession,
  screenIdFor,
  screenJoinUrl,
  screenLeaveBeaconBody,
  screenUrl,
  screenUrlLabel,
  screenViewFor,
  stageScale,
  submitterLabel,
  writeSession,
} from "./screenModel";

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

const throwingStorage = {
  getItem: () => { throw new Error("blocked"); },
  setItem: () => { throw new Error("blocked"); },
  removeItem: () => { throw new Error("blocked"); },
};

describe("screenViewFor", () => {
  const result = (phase) => ({ room: { phase }, players: [] });

  it("waits for the query and reports a missing room", () => {
    expect(screenViewFor(undefined)).toBe("loading");
    expect(screenViewFor(null)).toBe("missing");
  });

  it("does not show Quick Play rooms", () => {
    expect(screenViewFor({ room: { phase: "lobby", isPublic: true }, players: [] })).toBe("unavailable");
  });

  it("maps each room phase to its view", () => {
    expect(screenViewFor(result("lobby"))).toBe("lobby");
    expect(screenViewFor(result("promptVoting"))).toBe("prompt");
    expect(screenViewFor(result("songSelection"))).toBe("selection");
    expect(screenViewFor(result("results"))).toBe("results");
    expect(screenViewFor(result("gameOver"))).toBe("gameOver");
  });

  it("shows the song in rating, or tallying until the song arrives", () => {
    expect(screenViewFor(result("rating"), { songId: "s1" })).toBe("rating");
    expect(screenViewFor(result("rating"), null)).toBe("tallying");
    expect(screenViewFor(result("rating"), undefined)).toBe("tallying");
  });
});

describe("pickStatus", () => {
  it("splits players by whether they picked this round, names only", () => {
    const players = [
      { playerId: "a", name: "Ana", submittedRounds: [1, 2] },
      { playerId: "b", name: "Bo", submittedRounds: [1] },
      { playerId: "c", name: "Cy" },
      { playerId: "d", name: "Di", submittedRounds: [2], isWaiting: true },
    ];
    const { picked, waiting } = pickStatus(players, 2);
    expect(picked.map((p) => p.name)).toEqual(["Ana"]);
    expect(waiting.map((p) => p.name)).toEqual(["Bo", "Cy"]);
  });
});

describe("ratingVotes", () => {
  it("counts votes out of everyone but the song's picker", () => {
    expect(ratingVotes({ submitted: 2, total: 4 })).toEqual({ submitted: 2, total: 3 });
    expect(ratingVotes({ submitted: 0, total: 0 })).toEqual({ submitted: 0, total: 0 });
    expect(ratingVotes(undefined)).toEqual({ submitted: 0, total: 0 });
  });
});

describe("submitterLabel", () => {
  const song = { player: { id: "p1", name: "Kay" } };
  it("names the picker unless the room is anonymous", () => {
    expect(submitterLabel(song, false)).toBe("Kay");
    expect(submitterLabel(song, undefined)).toBe("Kay");
    expect(submitterLabel(song, true)).toBeNull();
  });
});

describe("screen URLs", () => {
  const origin = "https://www.aux-wars.com";
  it("builds the screen page, its typed label, and the tagged join link", () => {
    expect(screenUrl("ABC123", origin)).toBe("https://www.aux-wars.com/screen/ABC123");
    expect(screenUrlLabel("ABC123", origin)).toBe("aux-wars.com/screen/ABC123");
    expect(screenUrlLabel("ABC123", "http://localhost:5173")).toBe("localhost:5173/screen/ABC123");
    expect(screenJoinUrl("ABC123", origin)).toBe("https://www.aux-wars.com/lobby/ABC123?src=screen");
  });
});

describe("joinSourceFrom", () => {
  it("counts joins from the screen QR as screen joins, everything else as link", () => {
    expect(joinSourceFrom("?src=screen")).toBe("screen");
    expect(joinSourceFrom("?foo=1&src=screen")).toBe("screen");
    expect(joinSourceFrom("")).toBe("link");
    expect(joinSourceFrom("?src=other")).toBe("link");
    expect(joinSourceFrom(undefined)).toBe("link");
  });
});

describe("session storage helpers", () => {
  it("read and write, and survive blocked storage", () => {
    const storage = memoryStorage();
    writeSession("k", "1", storage);
    expect(readSession("k", storage)).toBe("1");
    writeSession("k", null, storage);
    expect(readSession("k", storage)).toBeNull();
    expect(readSession("k", throwingStorage)).toBeNull();
    expect(() => writeSession("k", "1", throwingStorage)).not.toThrow();
  });

  it("keeps one screen id per tab", () => {
    const storage = memoryStorage();
    const makeId = vi.fn(() => "id-1");
    expect(screenIdFor(storage, makeId)).toBe("id-1");
    expect(screenIdFor(storage, () => "id-2")).toBe("id-1");
    expect(makeId).toHaveBeenCalledTimes(1);
  });

  it("keys the phone audio choice by room", () => {
    expect(phoneAudioKey("ABC123")).toBe("auxwars:playOnPhone:ABC123");
  });
});

describe("screenLeaveBeaconBody", () => {
  it("targets screens:leave with the code and screen id", () => {
    expect(JSON.parse(screenLeaveBeaconBody({ code: "ABC123", screenId: "s1" }))).toEqual({
      path: "screens:leave",
      args: { code: "ABC123", screenId: "s1" },
      format: "json",
    });
  });
});

describe("stageScale", () => {
  it("fits the 1280x720 stage inside the display, letterboxed", () => {
    expect(stageScale(1920, 1080)).toBe(1.5);
    expect(stageScale(1280, 720)).toBe(1);
    expect(stageScale(1440, 900)).toBe(1.125);
    expect(stageScale(1280, 600)).toBeCloseTo(600 / 720);
    expect(stageScale(0, 0)).toBe(1);
  });
});
