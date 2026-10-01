import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import presenceComponent from "@convex-dev/presence/test";
import type { Doc } from "./_generated/dataModel";
import { CURATED_PROMPTS } from "./game/promptPacks";
import { PROMPT_VOTING_MS } from "./game/roomOps";
import {
  AUTO_ADVANCE_MS,
  AUTO_REMATCH_MS,
  COUNTDOWN_MS,
  ONE_V_ONE_OFFER_MS,
  PUBLIC_IN_GAME_GRACE_MS,
  PUBLIC_IN_GAME_OFFLINE_MS,
  PUBLIC_WAITING_TIMEOUT_MS,
  CLOSE_LEAVE_DELAY_MS,
  PLACEMENT_RECENT_MS,
  generateFunName,
  quickPlaySettings,
} from "./game/quickPlayRules";

const modules = import.meta.glob(["./**/*.ts", "./**/*.js", "!./**/*.test.ts", "!./**/*.d.ts"]);

type T = ReturnType<typeof setup>;

function setup() {
  const t = convexTest(schema, modules);
  presenceComponent.register(t, "presence");
  return t;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** Advance the clock and run whatever became due (and what that schedules). */
async function advance(t: T, ms: number) {
  vi.advanceTimersByTime(ms);
  await t.finishInProgressScheduledFunctions();
  for (let i = 0; i < 6; i++) {
    vi.advanceTimersByTime(1);
    await t.finishInProgressScheduledFunctions();
  }
}

const conn = (id: string) => `conn-${id}`;
const seatKey = (id: string) => `seat-key-${id}-0123456789abcdef`;

async function join(t: T, playerId: string, extra: { name?: string; connectionId?: string } = {}) {
  const res = await t.mutation(api.quickPlay.join, {
    playerId,
    connectionId: extra.connectionId ?? conn(playerId),
    seatKey: seatKey(playerId),
    ...(extra.name !== undefined ? { name: extra.name } : {}),
  });
  if (!res.success) throw new Error(`join failed: ${res.message}`);
  return res;
}

async function room(t: T, code: string) {
  return await t.run(async (ctx) =>
    ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", code)).unique()
  );
}

async function players(t: T, code: string) {
  return await t.run(async (ctx) =>
    ctx.db.query("players").withIndex("by_room", (q) => q.eq("roomCode", code)).collect()
  );
}

async function publicRooms(t: T) {
  return await t.run(async (ctx) => (await ctx.db.query("rooms").collect()).filter((r) => r.isPublic));
}

async function events(t: T, eventType: string) {
  return await t.run(async (ctx) =>
    ctx.db
      .query("analyticsEvents")
      .withIndex("by_type", (q) => q.eq("eventType", eventType))
      .collect()
  );
}

/** Insert a room directly (for placement scenarios joins alone can't build). */
async function insertRoom(
  t: T,
  code: string,
  fields: Partial<Doc<"rooms">> & { playerIds?: string[] } = {}
) {
  const { playerIds = [], ...roomFields } = fields;
  await t.run(async (ctx) => {
    await ctx.db.insert("rooms", {
      code,
      phase: "lobby",
      currentRound: 1,
      isPublic: true,
      settings: quickPlaySettings(),
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      ...roomFields,
    });
    for (const playerId of playerIds) {
      await ctx.db.insert("players", {
        roomCode: code,
        playerId,
        connectionId: conn(playerId),
        name: `QA-${playerId}`,
        isHost: false,
        isReady: false,
        connectedAt: Date.now(),
        isActive: true,
      });
    }
  });
}

/** A seated player's players doc _id (votes are keyed by it). */
async function docId(t: T, code: string, playerId: string) {
  const p = (await players(t, code)).find((x) => x.playerId === playerId);
  if (!p) throw new Error(`${playerId} is not seated in ${code}`);
  return p._id;
}

const leave = (t: T, code: string, playerId: string) =>
  t.mutation(api.game.rooms.leaveGame, { code, playerId, connectionId: conn(playerId) });

describe("placement", () => {
  test("first join opens a hostless public room with fixed settings and a generated name", async () => {
    const t = setup();
    const res = await join(t, "p1");
    expect(res.rejoined).toBe(false);
    expect(res.name).toMatch(/^\S+ \S+$/);

    const r = (await room(t, res.code))!;
    expect(r.isPublic).toBe(true);
    expect(r.phase).toBe("lobby");
    expect(r.hostPlayerId).toBeUndefined();
    expect(r.settings).toEqual({
      numberOfRounds: 3,
      roundLength: 60,
      snippetDuration: 30,
      selectedPrompts: CURATED_PROMPTS,
      enablePromptVoting: true,
      anonymousMode: false,
      hostPro: false,
    });

    const [p] = await players(t, res.code);
    expect(p.isHost).toBe(false);
    expect(p.name).toBe(res.name);
    expect(p.waitingSince).toBe(Date.now());

    const view = await t.query(api.game.rooms.getRoomByCode, { code: res.code });
    expect(view?.room).toMatchObject({ isPublic: true, playerCap: 6 });
    expect(await events(t, "quickplay_clicked")).toHaveLength(0); // scheduled, not yet run
    await advance(t, 0);
    expect(await events(t, "quickplay_clicked")).toHaveLength(1);
    expect(await events(t, "player_joined")).toHaveLength(1);
    const created = await events(t, "game_created");
    expect(created[0].metadata).toMatchObject({ roomCode: res.code, label: "quickplay" });
  });

  test("the second player joins the same room with a different name", async () => {
    const t = setup();
    const a = await join(t, "p1");
    const b = await join(t, "p2");
    expect(b.code).toBe(a.code);
    expect(b.name).not.toBe(a.name);
    expect(await publicRooms(t)).toHaveLength(1);
  });

  test("generated names avoid names already in the room", () => {
    let i = 0;
    const seq = [0, 0, 0, 0, 0.99, 0.99];
    const random = () => seq[Math.min(i++, seq.length - 1)];
    const first = generateFunName([], () => 0);
    expect(generateFunName([first], random)).not.toBe(first);
    // Every random pick collides: falls back to a numbered name.
    expect(generateFunName([first], () => 0)).toBe(`${first} 2`);
  });

  test("picks the open room with the most players", async () => {
    const t = setup();
    await insertRoom(t, "QAAAA1", { playerIds: ["a1"] });
    await insertRoom(t, "QAAAA2", { playerIds: ["b1", "b2"] });
    const res = await join(t, "p1");
    expect(res.code).toBe("QAAAA2");
  });

  test("never seats a player in a full, started, about-to-start, private or kicked-from room", async () => {
    const t = setup();
    const now = Date.now();
    await insertRoom(t, "QAFULL", { playerIds: ["f1", "f2", "f3", "f4", "f5", "f6"] });
    await insertRoom(t, "QAGAME", { phase: "songSelection", playerIds: ["g1", "g2", "g3", "g4"] });
    await insertRoom(t, "QASOON", { startsAt: now + 500, countdownArmedAt: now - 29_500, playerIds: ["s1", "s2", "s3"] });
    await insertRoom(t, "QAKICK", { kickedPlayerIds: ["p1"], playerIds: ["k1", "k2", "k3"] });
    await insertRoom(t, "QAPRIV", { isPublic: undefined, playerIds: ["v1"] });
    await insertRoom(t, "QAOVER", { phase: "gameOver", rematchStartingAt: now + 2000, playerIds: ["o1", "o2"] });

    const res = await join(t, "p1");
    expect(["QAFULL", "QAGAME", "QASOON", "QAKICK", "QAPRIV", "QAOVER"]).not.toContain(res.code);
    expect((await players(t, res.code)).map((p) => p.playerId)).toEqual(["p1"]);
  });

  test("seats players in a game-over room during its auto-rematch countdown", async () => {
    const t = setup();
    await insertRoom(t, "QAOVER", {
      phase: "gameOver",
      currentRound: 3,
      rematchStartingAt: Date.now() + 10_000,
      playerIds: ["o1", "o2", "o3"],
    });
    const res = await join(t, "p1");
    expect(res.code).toBe("QAOVER");
  });

  test("joining again returns the same seat and takes over the connection", async () => {
    const t = setup();
    const a = await join(t, "p1");
    const again = await join(t, "p1", { connectionId: "conn-new-tab" });
    expect(again).toMatchObject({ code: a.code, name: a.name, rejoined: true });
    const ps = await players(t, a.code);
    expect(ps).toHaveLength(1);
    expect(ps[0].connectionId).toBe("conn-new-tab");
  });

  test("a requested name is used when valid and rejected when not", async () => {
    const t = setup();
    expect((await join(t, "p1", { name: "  QA-Bob  " })).name).toBe("QA-Bob");
    const slur = await t.mutation(api.quickPlay.join, {
      playerId: "p2",
      connectionId: "c2",
      seatKey: seatKey("p2"),
      name: "faggot",
    });
    expect(slur.success).toBe(false);
    const long = await t.mutation(api.quickPlay.join, {
      playerId: "p3",
      connectionId: "c3",
      seatKey: seatKey("p3"),
      name: "x".repeat(51),
    });
    expect(long.success).toBe(false);
  });
});

describe("concurrent joins", () => {
  test("simultaneous joins from an empty pool share one room", async () => {
    const t = setup();
    const results = await Promise.all(["p1", "p2", "p3", "p4", "p5"].map((id) => join(t, id)));
    expect(new Set(results.map((r) => r.code)).size).toBe(1);
    expect(await publicRooms(t)).toHaveLength(1);
  });

  test("a burst past the cap fills one room and opens exactly one more", async () => {
    const t = setup();
    const ids = Array.from({ length: 8 }, (_, i) => `p${i + 1}`);
    const results = await Promise.all(ids.map((id) => join(t, id)));
    const byRoom = new Map<string, number>();
    for (const r of results) byRoom.set(r.code, (byRoom.get(r.code) ?? 0) + 1);
    expect([...byRoom.values()].sort()).toEqual([2, 6]);
  });
});

describe("start rule", () => {
  test("two players wait; the third arms a 30s countdown", async () => {
    const t = setup();
    const { code } = await join(t, "p1");
    await join(t, "p2");
    expect((await room(t, code))!.startsAt).toBeUndefined();
    await join(t, "p3");
    const r = (await room(t, code))!;
    expect(r.countdownArmedAt).toBe(Date.now());
    expect(r.startsAt).toBe(Date.now() + COUNTDOWN_MS);
  });

  test("each join extends the countdown by up to 10s, capped at 60s from arming", async () => {
    const t = setup();
    const { code } = await join(t, "p1");
    await join(t, "p2");
    await join(t, "p3");
    const armedAt = Date.now();
    await advance(t, 1000);
    await join(t, "p4");
    expect((await room(t, code))!.startsAt).toBe(armedAt + 40_000);
    await join(t, "p5");
    expect((await room(t, code))!.startsAt).toBe(armedAt + 50_000);
    // A leave never shortens it; churn cannot push it past the cap.
    await leave(t, code, "p5");
    expect((await room(t, code))!.startsAt).toBe(armedAt + 50_000);
    await join(t, "p6");
    expect((await room(t, code))!.startsAt).toBe(armedAt + 60_000);
    await leave(t, code, "p6");
    await join(t, "p7");
    expect((await room(t, code))!.startsAt).toBe(armedAt + 60_000);
  });

  test("dropping under 3 cancels the countdown and the stale timer does nothing", async () => {
    const t = setup();
    const { code } = await join(t, "p1");
    await join(t, "p2");
    await join(t, "p3");
    await leave(t, code, "p3");
    const r = (await room(t, code))!;
    expect(r.startsAt).toBeUndefined();
    expect(r.countdownArmedAt).toBeUndefined();
    await advance(t, COUNTDOWN_MS + 1000);
    expect((await room(t, code))!.phase).toBe("lobby");
  });

  test("the countdown starts the game when it fires and records the match", async () => {
    const t = setup();
    const { code } = await join(t, "p1");
    await advance(t, 5000);
    await join(t, "p2");
    await join(t, "p3");
    await advance(t, COUNTDOWN_MS);
    const r = (await room(t, code))!;
    expect(r.phase).toBe("promptVoting");
    expect(r.startsAt).toBeUndefined();
    expect(CURATED_PROMPTS).toContain(r.currentPrompt);
    for (const p of await players(t, code)) expect(p.waitingSince).toBeUndefined();

    const matched = await events(t, "quickplay_matched");
    expect(matched).toHaveLength(3);
    const p1 = matched.find((e) => e.metadata.playerId === "p1")!;
    expect(p1.metadata).toMatchObject({ playersAtStart: 3 });
    expect(p1.metadata.waitedMs).toBeGreaterThanOrEqual(COUNTDOWN_MS + 5000);
    const started = await events(t, "game_started");
    expect(started[0].metadata).toMatchObject({ playerCount: 3, label: "quickplay" });
  });

  test("an extended countdown ignores its superseded timer", async () => {
    const t = setup();
    const { code } = await join(t, "p1");
    await join(t, "p2");
    await join(t, "p3");
    await advance(t, 1000);
    await join(t, "p4"); // now fires at arm + 40s
    await advance(t, COUNTDOWN_MS); // original 30s timer fires: stale
    expect((await room(t, code))!.phase).toBe("lobby");
    await advance(t, 10_000);
    expect((await room(t, code))!.phase).toBe("promptVoting");
  });

  test("the sixth player starts the game at once; the seventh opens a new room", async () => {
    const t = setup();
    const results = [];
    for (let i = 1; i <= 6; i++) results.push(await join(t, `p${i}`));
    const code = results[0].code;
    expect(results.every((r) => r.code === code)).toBe(true);
    expect((await room(t, code))!.phase).toBe("promptVoting");
    const seventh = await join(t, "p7");
    expect(seventh.code).not.toBe(code);
    expect((await room(t, seventh.code))!.phase).toBe("lobby");
  });

  test("a unanimous Start now vote starts at once; a holdout leaving completes it", async () => {
    const t = setup();
    const { code } = await join(t, "p1");
    await join(t, "p2");
    await join(t, "p3");
    const vote = (id: string, v = true) =>
      t.mutation(api.quickPlay.voteStart, { code, playerId: id, connectionId: conn(id), vote: v });
    await vote("p1");
    await vote("p2");
    await vote("p2", false);
    expect((await room(t, code))!.startVotes).toEqual([await docId(t, code, "p1")]);
    await vote("p2");
    expect((await room(t, code))!.phase).toBe("lobby");
    await leave(t, code, "p3");
    expect((await room(t, code))!.phase).toBe("promptVoting");
  });

  test("a single player cannot start a game by voting", async () => {
    const t = setup();
    const { code } = await join(t, "p1");
    await t.mutation(api.quickPlay.voteStart, { code, playerId: "p1", connectionId: conn("p1") });
    expect((await room(t, code))!.phase).toBe("lobby");
  });
});

describe("1v1 offer", () => {
  test("offered after ~60s with exactly two; starts only when both accept", async () => {
    const t = setup();
    const { code } = await join(t, "p1");
    await join(t, "p2");
    await advance(t, ONE_V_ONE_OFFER_MS - 1000);
    expect((await room(t, code))!.oneVOneOffered).toBeFalsy();
    await advance(t, 1000);
    expect((await room(t, code))!.oneVOneOffered).toBe(true);
    expect(await events(t, "quickplay_1v1_offered")).toHaveLength(1);

    const respond = (id: string, accept: boolean) =>
      t.mutation(api.quickPlay.respondOneVOne, { code, playerId: id, connectionId: conn(id), accept });
    await respond("p1", true);
    expect((await room(t, code))!.phase).toBe("lobby");
    await respond("p2", true);
    await advance(t, 0);
    expect((await room(t, code))!.phase).toBe("promptVoting");
    expect(await events(t, "quickplay_1v1_accepted")).toHaveLength(1);
  });

  test("a decline withdraws the offer; a third player clears it and arms the countdown", async () => {
    const t = setup();
    const { code } = await join(t, "p1");
    await join(t, "p2");
    await advance(t, ONE_V_ONE_OFFER_MS);
    await t.mutation(api.quickPlay.respondOneVOne, { code, playerId: "p1", connectionId: conn("p1"), accept: false });
    let r = (await room(t, code))!;
    expect(r.oneVOneOffered).toBe(false);
    expect(r.oneVOneOfferAt).toBe(Date.now() + ONE_V_ONE_OFFER_MS);
    for (const id of ["p1", "p2"]) {
      await t.mutation(api.presence.heartbeat, { roomId: code, userId: id, sessionId: `s-${id}`, interval: 30_000 });
    }
    await join(t, "p3");
    r = (await room(t, code))!;
    expect(r.oneVOneOfferAt).toBeUndefined();
    expect(r.startsAt).toBeDefined();
    await advance(t, ONE_V_ONE_OFFER_MS - COUNTDOWN_MS); // countdown fires first; offer timer is stale
    r = (await room(t, code))!;
    expect(r.phase).toBe("promptVoting");
    expect(r.oneVOneOffered).toBeFalsy();
  });
});

describe("leaving", () => {
  test("the last player leaving deletes the room and records abandon-while-waiting", async () => {
    const t = setup();
    const { code } = await join(t, "p1");
    await advance(t, 4000);
    const res = await leave(t, code, "p1");
    expect(res).toMatchObject({ roomDeleted: true });
    expect(await room(t, code)).toBeNull();
    await advance(t, 0);
    const left = await events(t, "quickplay_left_waiting");
    expect(left).toHaveLength(1);
    expect(left[0].metadata.waitedMs).toBeGreaterThanOrEqual(4000);
  });

  test("a player who drops to one mid-game sends the room back to the waiting lobby", async () => {
    const t = setup();
    const { code } = await join(t, "p1");
    await join(t, "p2");
    await t.mutation(api.quickPlay.voteStart, { code, playerId: "p1", connectionId: conn("p1") });
    await t.mutation(api.quickPlay.voteStart, { code, playerId: "p2", connectionId: conn("p2") });
    expect((await room(t, code))!.phase).toBe("promptVoting");
    await leave(t, code, "p2");
    const r = (await room(t, code))!;
    expect(r.phase).toBe("lobby");
    expect(r.currentRound).toBe(1);
    expect(await events(t, "quickplay_left_waiting")).toHaveLength(0);
  });
});

describe("timers from an abandoned game", () => {
  const SELECTION_MS = quickPlaySettings().roundLength * 1000;

  test("a game that restarts after falling under 2 players keeps its full selection window", async () => {
    const t = setup();
    const { code } = await join(t, "p1");
    await join(t, "p2");
    await join(t, "p3");
    await advance(t, COUNTDOWN_MS);
    expect((await room(t, code))!.gameEpoch).toBe(1);
    await advance(t, PROMPT_VOTING_MS);
    expect((await room(t, code))!.phase).toBe("songSelection"); // old selection timer armed for ~60s from here

    await advance(t, 5000);
    await leave(t, code, "p2");
    await leave(t, code, "p3");
    expect((await room(t, code))!.phase).toBe("lobby");

    await join(t, "p4");
    for (const id of ["p1", "p4"]) {
      await t.mutation(api.quickPlay.voteStart, { code, playerId: id, connectionId: conn(id) });
    }
    let r = (await room(t, code))!;
    expect(r.phase).toBe("promptVoting");
    expect(r.gameEpoch).toBe(2);
    await advance(t, PROMPT_VOTING_MS);
    r = (await room(t, code))!;
    expect(r.phase).toBe("songSelection");
    const newSelectionStart = r.selectionStartedAt!;

    // The abandoned game's endSelectionPhase({ round: 1 }) comes due here.
    await advance(t, SELECTION_MS - 20_000);
    r = (await room(t, code))!;
    expect(r.phase).toBe("songSelection");
    expect(r.selectionStartedAt).toBe(newSelectionStart);
    expect(await t.run(async (ctx) => ctx.db.query("roundResults").collect())).toHaveLength(0);

    // The new game's own timer still ends the round on schedule.
    await advance(t, 20_000);
    expect((await room(t, code))!.phase).toBe("results");
  });

  test("a stale rating step from an earlier game does nothing", async () => {
    const t = setup();
    await insertRoom(t, "QAEPOC", {
      phase: "rating",
      currentRound: 1,
      currentRatingIndex: 0,
      gameEpoch: 2,
      playerIds: ["e1", "e2"],
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("submissions", {
        roomCode: "QAEPOC",
        round: 1,
        playerId: "e1",
        trackId: "qa-track",
        trackDetails: { name: "QA Song", artist: "QA Artist", albumCover: "", previewUrl: "https://example.test/a.mp3" },
        submittedAt: Date.now(),
      });
    });
    for (const [round, epoch] of [
      [1, 1],
      [1, undefined],
    ] as const) {
      await t.mutation(internal.game.flow.advanceRating, {
        code: "QAEPOC",
        round,
        ratingIndex: 0,
        timedOut: true,
        ...(epoch !== undefined ? { epoch } : {}),
      });
    }
    await t.mutation(internal.game.flow.calculateResultsInternal, { code: "QAEPOC", round: 1, epoch: 1 });
    const r = (await room(t, "QAEPOC"))!;
    expect(r.phase).toBe("rating");
    expect(r.currentRatingIndex).toBe(0);

    await t.mutation(internal.game.flow.advanceRating, {
      code: "QAEPOC",
      round: 1,
      ratingIndex: 0,
      timedOut: true,
      epoch: 2,
    });
    expect((await room(t, "QAEPOC"))!.currentRatingIndex).toBe(1);
  });

  test("skipping the prompt restarts the voting window; the first timer is ignored", async () => {
    const t = setup();
    const { code } = await join(t, "p1");
    await join(t, "p2");
    for (const id of ["p1", "p2"]) {
      await t.mutation(api.quickPlay.voteStart, { code, playerId: id, connectionId: conn(id) });
    }
    expect((await room(t, code))!.phase).toBe("promptVoting");
    await advance(t, 10_000);
    for (const id of ["p1", "p2"]) {
      await t.mutation(api.game.flow.voteSkipPrompt, { code, playerId: id, connectionId: conn(id) });
    }
    const skippedAt = (await room(t, code))!.promptVotingStartedAt!;
    await advance(t, PROMPT_VOTING_MS - 10_000); // the pre-skip timer comes due
    let r = (await room(t, code))!;
    expect(r.phase).toBe("promptVoting");
    expect(r.promptVotingStartedAt).toBe(skippedAt);
    await advance(t, 10_000);
    r = (await room(t, code))!;
    expect(r.phase).toBe("songSelection");
  });
});

describe("host-only actions on public rooms", () => {
  test("settings, lock, kick, custom prompts, manual start/advance/lobby and code joins are rejected", async () => {
    const t = setup();
    const { code } = await join(t, "p1");
    await join(t, "p2");
    await join(t, "p3");
    const me = { code, playerId: "p1", connectionId: conn("p1") };

    expect(
      await t.mutation(api.game.rooms.updateSettings, {
        ...me,
        numberOfRounds: 10,
        roundLength: 0,
        snippetDuration: 0,
        selectedPrompts: ["a", "b", "c", "d", "e"],
      })
    ).toMatchObject({ success: false });
    expect(await t.mutation(api.game.rooms.setRoomLock, { ...me, locked: true })).toMatchObject({ success: false });
    expect(
      await t.mutation(api.game.rooms.kickPlayer, {
        code,
        hostPlayerId: "p1",
        hostConnectionId: conn("p1"),
        targetPlayerId: "p2",
      })
    ).toMatchObject({ success: false });
    expect(
      await t.mutation(api.game.rooms.addCustomPrompt, { code, text: "QA custom prompt", createdBy: "p1" })
    ).toMatchObject({ success: false });
    expect(
      await t.mutation(api.game.rooms.addCustomPrompts, { code, prompts: ["QA one", "QA two"], createdBy: "p1" })
    ).toMatchObject({ success: false, added: 0 });
    expect(
      await t.mutation(api.game.rooms.joinGame, { code, playerId: "x1", connectionId: "cx", name: "QA-x" })
    ).toMatchObject({ success: false });

    await t.mutation(api.game.flow.startGame, me);
    const r = (await room(t, code))!;
    expect(r.phase).toBe("lobby");
    expect(r.settings).toEqual(quickPlaySettings());
    expect(r.locked).toBeUndefined();
    expect(await players(t, code)).toHaveLength(3);
    expect(await t.query(api.game.rooms.getCustomPrompts, { code })).toEqual([]);

    // Reconnect by code still works for a seated player.
    expect(
      await t.mutation(api.game.rooms.joinGame, {
        code,
        playerId: "p2",
        connectionId: "conn-p2-b",
        name: "QA-p2",
        seatKey: seatKey("p2"),
      })
    ).toMatchObject({ success: true, tookOver: true });
  });

  test("nextRound, returnToLobby and rematch controls do nothing on a public room", async () => {
    const t = setup();
    await insertRoom(t, "QARSLT", { phase: "results", currentRound: 1, playerIds: ["p1", "p2", "p3"] });
    const me = { code: "QARSLT", playerId: "p1", connectionId: conn("p1") };
    await t.mutation(api.game.flow.nextRound, me);
    expect((await room(t, "QARSLT"))!.phase).toBe("results");
    await t.mutation(api.game.flow.returnToLobby, me);
    expect((await room(t, "QARSLT"))!.phase).toBe("results");

    await insertRoom(t, "QAOVER", {
      phase: "gameOver",
      currentRound: 3,
      rematchStartingAt: Date.now() + AUTO_REMATCH_MS,
      playerIds: ["o1", "o2"],
    });
    const o1 = { code: "QAOVER", playerId: "o1", connectionId: conn("o1") };
    await t.mutation(api.game.flow.cancelRematch, o1);
    await t.mutation(api.game.flow.returnToLobby, o1);
    const r = (await room(t, "QAOVER"))!;
    expect(r.phase).toBe("gameOver");
    expect(r.rematchStartingAt).toBeDefined();
  });
});

describe("hostless game flow", () => {
  async function ratingRoom(t: T, code: string, round: number, isPublic: boolean | undefined) {
    await insertRoom(t, code, {
      isPublic,
      phase: "rating",
      currentRound: round,
      currentPrompt: CURATED_PROMPTS[0],
      usedPrompts: [CURATED_PROMPTS[0]],
      playerIds: ["p1", "p2", "p3"],
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("submissions", {
        roomCode: code,
        round,
        playerId: "p1",
        trackId: "qa-track",
        trackDetails: { name: "QA Song", artist: "QA Artist", albumCover: "", previewUrl: "https://example.test/a.mp3" },
        submittedAt: Date.now(),
      });
    });
  }

  test("results auto-advance to the next round after ~8s", async () => {
    const t = setup();
    await ratingRoom(t, "QAPUB1", 1, true);
    await t.mutation(internal.game.flow.calculateResultsInternal, { code: "QAPUB1" });
    let r = (await room(t, "QAPUB1"))!;
    expect(r.phase).toBe("results");
    expect(r.autoAdvanceAt).toBe(Date.now() + AUTO_ADVANCE_MS);
    await advance(t, AUTO_ADVANCE_MS - 1000);
    expect((await room(t, "QAPUB1"))!.phase).toBe("results");
    await advance(t, 1000);
    r = (await room(t, "QAPUB1"))!;
    expect(r.phase).toBe("promptVoting");
    expect(r.currentRound).toBe(2);
    expect(r.autoAdvanceAt).toBeUndefined();
  });

  test("private results wait for the host", async () => {
    const t = setup();
    await ratingRoom(t, "QAPRV1", 1, undefined);
    await t.mutation(internal.game.flow.calculateResultsInternal, { code: "QAPRV1" });
    expect((await room(t, "QAPRV1"))!.autoAdvanceAt).toBeUndefined();
    await advance(t, AUTO_ADVANCE_MS * 3);
    expect((await room(t, "QAPRV1"))!.phase).toBe("results");
  });

  test("after the last round: game over, a 15s auto-rematch, and refilled seats join it", async () => {
    const t = setup();
    await ratingRoom(t, "QAPUB3", 3, true);
    await t.mutation(internal.game.flow.calculateResultsInternal, { code: "QAPUB3" });
    await advance(t, AUTO_ADVANCE_MS);
    let r = (await room(t, "QAPUB3"))!;
    expect(r.phase).toBe("gameOver");
    expect(r.rematchStartingAt).toBe(Date.now() - 6 + AUTO_REMATCH_MS); // armed before the settle ticks

    const late = await join(t, "p4");
    expect(late.code).toBe("QAPUB3");
    await advance(t, AUTO_REMATCH_MS);
    r = (await room(t, "QAPUB3"))!;
    expect(r.phase).toBe("promptVoting");
    expect(r.currentRound).toBe(1);
    expect(r.rematchStartingAt).toBeUndefined();
    expect(await players(t, "QAPUB3")).toHaveLength(4);
    expect(await t.run(async (ctx) => ctx.db.query("submissions").collect())).toHaveLength(0);
    // Only the refilled seat was still waiting for a first game.
    const matched = await events(t, "quickplay_matched");
    expect(matched.map((e) => e.metadata.playerId)).toEqual(["p4"]);
    expect(matched[0].metadata.playersAtStart).toBe(4);
  });

  test("a rematch with fewer than 2 players goes back to the waiting lobby", async () => {
    const t = setup();
    await insertRoom(t, "QAOVER", {
      phase: "gameOver",
      currentRound: 3,
      rematchStartingAt: Date.now() + AUTO_REMATCH_MS,
      playerIds: ["o1", "o2"],
    });
    await t.mutation(internal.game.flow.autoAdvance, { code: "QAOVER", fireAt: 0 }); // stale: no-op
    await leave(t, "QAOVER", "o2");
    expect((await room(t, "QAOVER"))!.phase).toBe("gameOver");
    await t.mutation(internal.game.flow.executeRematch, {
      code: "QAOVER",
      startAt: (await room(t, "QAOVER"))!.rematchStartingAt!,
    });
    const r = (await room(t, "QAOVER"))!;
    expect(r.phase).toBe("lobby");
    expect(r.rematchStartingAt).toBeUndefined();
    expect((await players(t, "QAOVER")).map((p) => p.playerId)).toEqual(["o1"]);
  });
});

describe("majority kick", () => {
  test("a majority of the other players removes someone, who is not matched back in", async () => {
    const t = setup();
    const { code } = await join(t, "p1");
    for (const id of ["p2", "p3", "p4"]) await join(t, id);
    const target = await docId(t, code, "p4");
    const kick = (voter: string) =>
      t.mutation(api.quickPlay.voteKick, { code, playerId: voter, connectionId: conn(voter), targetPlayerDocId: target });

    expect(await kick("p1")).toMatchObject({ success: true, kicked: false, votes: 1, needed: 2 });
    expect(await kick("p1")).toMatchObject({ kicked: false, votes: 1 }); // double vote ignored
    expect(await kick("p2")).toMatchObject({ success: true, kicked: true });

    const r = (await room(t, code))!;
    expect((await players(t, code)).map((p) => p.playerId)).not.toContain("p4");
    expect(r.kickedPlayerIds).toEqual(["p4"]);
    expect(r.kickVotes).toEqual([]);
    const back = await join(t, "p4");
    expect(back.code).not.toBe(code);
  });

  test("needs at least 3 players and cannot target yourself", async () => {
    const t = setup();
    const { code } = await join(t, "p1");
    await join(t, "p2");
    const res = await t.mutation(api.quickPlay.voteKick, {
      code,
      playerId: "p1",
      connectionId: conn("p1"),
      targetPlayerDocId: await docId(t, code, "p2"),
    });
    expect(res.success).toBe(false);
    const self = await t.mutation(api.quickPlay.voteKick, {
      code,
      playerId: "p1",
      connectionId: conn("p1"),
      targetPlayerDocId: await docId(t, code, "p1"),
    });
    expect(self.success).toBe(false);
    expect(await players(t, code)).toHaveLength(2);
  });

  test("votes from or against players who left are dropped", async () => {
    const t = setup();
    const { code } = await join(t, "p1");
    for (const id of ["p2", "p3", "p4", "p5"]) await join(t, id);
    const p4 = await docId(t, code, "p4");
    const p2 = await docId(t, code, "p2");
    await t.mutation(api.quickPlay.voteKick, {
      code,
      playerId: "p1",
      connectionId: conn("p1"),
      targetPlayerDocId: await docId(t, code, "p5"),
    });
    await t.mutation(api.quickPlay.voteKick, { code, playerId: "p2", connectionId: conn("p2"), targetPlayerDocId: p4 });
    await leave(t, code, "p1");
    expect((await room(t, code))!.kickVotes).toEqual([{ targetId: p4, voterIds: [p2] }]);
  });

  test("clients see an anonymous tally per target, never who voted", async () => {
    const t = setup();
    const { code } = await join(t, "p1");
    for (const id of ["p2", "p3", "p4", "p5"]) await join(t, id);
    const p5 = await docId(t, code, "p5");
    const voter = await docId(t, code, "p1");
    await t.mutation(api.quickPlay.voteKick, { code, playerId: "p1", connectionId: conn("p1"), targetPlayerDocId: p5 });

    const view = (await t.query(api.game.rooms.getRoomByCode, { code }))!;
    expect(view.room).toMatchObject({ kickTallies: [{ targetPlayerDocId: p5, votes: 1, needed: 3 }] });
    expect(view.room).not.toHaveProperty("kickVotes");
    expect(view.room).not.toHaveProperty("kickedPlayerIds");
    const json = JSON.stringify(view.room);
    expect(json).not.toContain("voterIds");
    // The voter's doc id appears nowhere in the room payload (only in the
    // players list, which it always does).
    expect(json).not.toContain(voter);
    expect(JSON.stringify(await t.query(api.game.rooms.getPlayers, { code }))).not.toContain("voterIds");
  });
});

describe("seat ownership", () => {
  // Every client in a room reads the other players' playerIds, so a playerId
  // alone must not let a stranger take over a seat.
  test("a stranger presenting another player's playerId cannot rejoin or vote as them", async () => {
    const t = setup();
    const { code } = await join(t, "p1");
    for (const id of ["p2", "p3", "p4"]) await join(t, id);
    const strangerConn = "conn-stranger";
    const strangerKey = "stranger-key-0123456789abcdef";

    // Through Quick Play, with a wrong key or with no valid key.
    expect(
      await t.mutation(api.quickPlay.join, { playerId: "p2", connectionId: strangerConn, seatKey: strangerKey })
    ).toMatchObject({ success: false });
    expect(
      await t.mutation(api.quickPlay.join, { playerId: "p2", connectionId: strangerConn, seatKey: "short" })
    ).toMatchObject({ success: false });

    // Through a code reconnect, with a wrong key or none.
    expect(
      await t.mutation(api.game.rooms.joinGame, {
        code,
        playerId: "p2",
        connectionId: strangerConn,
        name: "QA-stranger",
        seatKey: strangerKey,
      })
    ).toMatchObject({ success: false });
    expect(
      await t.mutation(api.game.rooms.joinGame, { code, playerId: "p2", connectionId: strangerConn, name: "QA-stranger" })
    ).toMatchObject({ success: false });

    const p2 = (await players(t, code)).find((p) => p.playerId === "p2")!;
    expect(p2.connectionId).toBe(conn("p2"));
    expect(p2.name).not.toBe("QA-stranger");

    // The stranger's connection cannot vote as p2 or p3.
    for (const voter of ["p2", "p3"]) {
      expect(
        await t.mutation(api.quickPlay.voteKick, {
          code,
          playerId: voter,
          connectionId: strangerConn,
          targetPlayerDocId: await docId(t, code, "p4"),
        })
      ).toMatchObject({ success: false });
    }
    expect(
      await t.mutation(api.quickPlay.voteStart, { code, playerId: "p2", connectionId: strangerConn })
    ).toMatchObject({ success: false });
    const r = (await room(t, code))!;
    expect(r.kickVotes ?? []).toEqual([]);
    expect(r.startVotes ?? []).toEqual([]);
    expect((await players(t, code)).map((p) => p.playerId)).toContain("p4");
  });

  test("the seat key is stored hashed and never returned by room queries", async () => {
    const t = setup();
    const { code } = await join(t, "p1");
    const [p1] = await players(t, code);
    expect(p1.seatKeyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(p1.seatKeyHash).not.toContain(seatKey("p1"));
    const view = await t.query(api.game.rooms.getRoomByCode, { code });
    const list = await t.query(api.game.rooms.getPlayers, { code });
    expect(JSON.stringify(view)).not.toContain(p1.seatKeyHash!);
    expect(JSON.stringify(list)).not.toContain(p1.seatKeyHash!);
  });

  test("a public seat without a stored key cannot be taken over", async () => {
    const t = setup();
    await insertRoom(t, "QAKEYS", { playerIds: ["o1", "o2"] });
    expect(
      await t.mutation(api.game.rooms.joinGame, {
        code: "QAKEYS",
        playerId: "o1",
        connectionId: "conn-other",
        name: "QA-other",
        seatKey: seatKey("o1"),
      })
    ).toMatchObject({ success: false });
  });

  test("placement never seats a playerId twice in one room", async () => {
    const t = setup();
    // o1 is seated in the only open room, but its membership is not found by
    // the bounded scan (simulated with a seat in more private rooms than it reads).
    await insertRoom(t, "QAFULL", { playerIds: ["o1", "o2"] });
    await t.run(async (ctx) => {
      for (let i = 0; i < 25; i++) {
        const code = `AAA${String(i).padStart(3, "0")}`;
        await ctx.db.insert("rooms", {
          code,
          phase: "lobby",
          currentRound: 1,
          settings: quickPlaySettings(),
          createdAt: Date.now(),
          lastActivityAt: Date.now(),
        });
        await ctx.db.insert("players", {
          roomCode: code,
          playerId: "o1",
          connectionId: "conn-x",
          name: "QA-o1",
          isHost: true,
          isReady: false,
        });
      }
    });
    const res = await t.mutation(api.quickPlay.join, {
      playerId: "o1",
      connectionId: "conn-stranger",
      seatKey: "stranger-key-0123456789abcdef",
    });
    if (res.success) expect(res.code).not.toBe("QAFULL");
    expect((await players(t, "QAFULL")).filter((p) => p.playerId === "o1")).toHaveLength(1);
  });

  test("private rooms keep keyless reconnects and honor a key once one is stored", async () => {
    const t = setup();
    const { code } = await t.mutation(api.game.rooms.hostGame, {});
    await t.mutation(api.game.rooms.joinGame, { code, playerId: "h", connectionId: "c-h", name: "QA-h" });
    await t.mutation(api.game.rooms.joinGame, {
      code,
      playerId: "k",
      connectionId: "c-k",
      name: "QA-k",
      seatKey: seatKey("k"),
    });

    expect(
      await t.mutation(api.game.rooms.joinGame, { code, playerId: "h", connectionId: "c-h2", name: "QA-h" })
    ).toMatchObject({ success: true, tookOver: true });
    expect(
      await t.mutation(api.game.rooms.joinGame, { code, playerId: "k", connectionId: "c-k2", name: "QA-k" })
    ).toMatchObject({ success: false });
    expect(
      await t.mutation(api.game.rooms.joinGame, {
        code,
        playerId: "k",
        connectionId: "c-k2",
        name: "QA-k",
        seatKey: seatKey("k"),
      })
    ).toMatchObject({ success: true, tookOver: true });
  });
});

describe("waitingCount", () => {
  test("counts players in public lobbies only", async () => {
    const t = setup();
    expect(await t.query(api.quickPlay.waitingCount, {})).toEqual({ waiting: 0 });
    await join(t, "p1");
    await join(t, "p2");
    await insertRoom(t, "QAGAME", { phase: "songSelection", playerIds: ["g1", "g2", "g3"] });
    await insertRoom(t, "QAPRIV", { isPublic: undefined, playerIds: ["v1", "v2"] });
    expect(await t.query(api.quickPlay.waitingCount, {})).toEqual({ waiting: 2 });
  });
});

describe("disconnected players", () => {
  test("the cron drops an offline waiting player after the public grace and records it", async () => {
    const t = setup();
    const { code } = await join(t, "p1");
    await join(t, "p2"); // never heartbeats
    await insertRoom(t, "QAPRIV", { isPublic: undefined, playerIds: ["v1"] });
    await advance(t, PUBLIC_WAITING_TIMEOUT_MS + 60_000);
    await t.mutation(api.presence.heartbeat, { roomId: code, userId: "p1", sessionId: "s1", interval: 30_000 });
    await t.mutation(internal.game.scheduler.cleanupInactivePlayers, {});
    expect((await players(t, code)).map((p) => p.playerId)).toEqual(["p1"]);
    expect((await room(t, code))!.oneVOneOffered).toBeFalsy();
    await advance(t, 0);
    expect(await events(t, "quickplay_left_waiting")).toHaveLength(1);
    // Private rooms keep their long grace window.
    expect(await players(t, "QAPRIV")).toHaveLength(1);
  });

  test("a launch drops players presence has reported gone for minutes", async () => {
    const t = setup();
    const { code } = await join(t, "p1");
    await join(t, "p3");
    const online = (id: string) =>
      t.mutation(api.presence.heartbeat, { roomId: code, userId: id, sessionId: `s-${id}`, interval: 30_000 });
    await online("p1");
    const tokens = await online("p3");
    await t.mutation(api.presence.disconnect, { sessionToken: tokens.sessionToken });
    await advance(t, PUBLIC_WAITING_TIMEOUT_MS);
    await online("p1"); // p1 stayed; p3 has been gone for minutes
    expect((await join(t, "p2")).code).toBe(code);
    expect((await room(t, code))!.startsAt).toBeDefined();
    await advance(t, COUNTDOWN_MS);
    const r = (await room(t, code))!;
    expect(r.phase).toBe("lobby");
    expect(r.startsAt).toBeUndefined();
    expect((await players(t, code)).map((p) => p.playerId).sort()).toEqual(["p1", "p2"]);
  });

  test("a player who only switched tabs while waiting still gets the game", async () => {
    const t = setup();
    const { code } = await join(t, "p1");
    await join(t, "p2");
    await join(t, "p3");
    const tokens = await t.mutation(api.presence.heartbeat, {
      roomId: code,
      userId: "p3",
      sessionId: "s3",
      interval: 30_000,
    });
    await t.mutation(api.presence.disconnect, { sessionToken: tokens.sessionToken }); // tab hidden
    await advance(t, COUNTDOWN_MS);
    expect((await room(t, code))!.phase).toBe("promptVoting");
    expect(await players(t, code)).toHaveLength(3);
  });
});

describe("dropouts in a running public game", () => {
  const track = (playerId: string) => ({
    trackId: `qa-${playerId}`,
    trackDetails: { name: `QA ${playerId}`, artist: "QA Artist", albumCover: "", previewUrl: "https://example.test/a.mp3" },
  });

  /** Registers (or refreshes) a presence session, so the player counts as online. */
  const online = (t: T, code: string, playerId: string) =>
    t.mutation(api.presence.heartbeat, { roomId: code, userId: playerId, sessionId: `s-${playerId}`, interval: 30_000 });

  /** The player's tab closes: presence reports them offline from now. */
  async function dropOut(t: T, code: string, playerId: string) {
    const tokens = await online(t, code, playerId);
    await t.mutation(api.presence.disconnect, { sessionToken: tokens.sessionToken });
  }

  /** A room rating round 1 of game 1, with a submission per `submitters` (rated in that order). */
  async function ratingRoom(t: T, code: string, playerIds: string[], submitters: string[], isPublic = true) {
    await insertRoom(t, code, {
      isPublic,
      phase: "rating",
      currentRound: 1,
      currentRatingIndex: 0,
      gameEpoch: 1,
      currentPrompt: CURATED_PROMPTS[0],
      usedPrompts: [CURATED_PROMPTS[0]],
      playerIds,
    });
    await t.run(async (ctx) => {
      for (const playerId of submitters) {
        await ctx.db.insert("submissions", { roomCode: code, round: 1, playerId, ...track(playerId), submittedAt: Date.now() });
      }
    });
  }

  async function currentSongId(t: T, code: string) {
    const r = (await room(t, code))!;
    const subs = await t.run(async (ctx) =>
      ctx.db.query("submissions").withIndex("by_room_round", (q) => q.eq("roomCode", code).eq("round", 1)).collect()
    );
    return subs[r.currentRatingIndex ?? 0]._id;
  }

  const rate = async (t: T, code: string, playerId: string) =>
    t.mutation(api.game.flow.submitRating, {
      code,
      playerId,
      connectionId: conn(playerId),
      songId: await currentSongId(t, code),
      rating: 4,
    });

  test("a song moves on once everyone still present has rated, not after the 60s timeout", async () => {
    const t = setup();
    await ratingRoom(t, "QADROP", ["p1", "p2", "p3", "p4"], ["p1", "p2", "p3"]);
    for (const id of ["p1", "p2", "p3"]) await online(t, "QADROP", id);
    await dropOut(t, "QADROP", "p4");
    await advance(t, PUBLIC_IN_GAME_GRACE_MS);

    const start = Date.now();
    expect((await rate(t, "QADROP", "p2")).success).toBe(true);
    await advance(t, 0);
    expect((await room(t, "QADROP"))!.currentRatingIndex).toBe(0); // p3 is online and still rating
    expect((await rate(t, "QADROP", "p3")).success).toBe(true);
    await advance(t, 0);
    expect((await room(t, "QADROP"))!.currentRatingIndex).toBe(1);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  test("a player who just closed their tab holds the song only for the grace window", async () => {
    const t = setup();
    await ratingRoom(t, "QAGRCE", ["p1", "p2", "p3", "p4"], ["p1", "p2", "p3"]);
    for (const id of ["p1", "p2", "p3"]) await online(t, "QAGRCE", id);
    await dropOut(t, "QAGRCE", "p4");

    await rate(t, "QAGRCE", "p2");
    await rate(t, "QAGRCE", "p3");
    await advance(t, 0);
    expect((await room(t, "QAGRCE"))!.currentRatingIndex).toBe(0); // could still be a page refresh
    await advance(t, PUBLIC_IN_GAME_GRACE_MS - 1000);
    expect((await room(t, "QAGRCE"))!.currentRatingIndex).toBe(0);
    await advance(t, 1000); // the grace runs out: nobody else to wait for
    expect((await room(t, "QAGRCE"))!.currentRatingIndex).toBe(1);
  });

  test("a player who comes back inside the grace window is still waited for", async () => {
    const t = setup();
    await ratingRoom(t, "QABACK", ["p1", "p2", "p3"], ["p1", "p2"]);
    for (const id of ["p1", "p2"]) await online(t, "QABACK", id);
    await dropOut(t, "QABACK", "p3");
    await advance(t, 5000);
    await online(t, "QABACK", "p3"); // refreshed

    await rate(t, "QABACK", "p2");
    await advance(t, PUBLIC_IN_GAME_GRACE_MS);
    expect((await room(t, "QABACK"))!.currentRatingIndex).toBe(0);
    await rate(t, "QABACK", "p3");
    await advance(t, 0);
    expect((await room(t, "QABACK"))!.currentRatingIndex).toBe(1);
  });

  test("a song nobody present can rate moves on at once", async () => {
    const t = setup();
    await ratingRoom(t, "QAALON", ["p1", "p2", "p3"], ["p1", "p2"]);
    await online(t, "QAALON", "p1");
    await dropOut(t, "QAALON", "p2");
    await dropOut(t, "QAALON", "p3");
    await advance(t, PUBLIC_IN_GAME_GRACE_MS);

    await t.mutation(internal.game.flow.advanceRating, {
      code: "QAALON",
      round: 1,
      ratingIndex: 0,
      timedOut: false,
      epoch: 1,
    });
    expect((await room(t, "QAALON"))!.currentRatingIndex).toBe(1);
    // p2's song: p1 rates it, and the round is over.
    await advance(t, 500);
    expect((await rate(t, "QAALON", "p1")).success).toBe(true);
    await advance(t, 0); // the "everyone rated" check moves to the end of the list...
    await advance(t, 500); // ...and the next step totals the round
    expect((await room(t, "QAALON"))!.phase).toBe("results");
  });

  test("private rooms still wait for every player", async () => {
    const t = setup();
    await ratingRoom(t, "QAPRVR", ["p1", "p2", "p3", "p4"], ["p1", "p2", "p3"], false);
    for (const id of ["p1", "p2", "p3"]) await online(t, "QAPRVR", id);
    await dropOut(t, "QAPRVR", "p4");
    await advance(t, PUBLIC_IN_GAME_GRACE_MS);

    await rate(t, "QAPRVR", "p2");
    await rate(t, "QAPRVR", "p3");
    await advance(t, PUBLIC_IN_GAME_GRACE_MS);
    expect((await room(t, "QAPRVR"))!.currentRatingIndex).toBe(0);
  });

  test("song selection ends once everyone still present has submitted", async () => {
    const t = setup();
    await insertRoom(t, "QASELX", {
      phase: "songSelection",
      currentRound: 1,
      gameEpoch: 1,
      currentPrompt: CURATED_PROMPTS[0],
      usedPrompts: [CURATED_PROMPTS[0]],
      selectionStartedAt: Date.now(),
      playerIds: ["p1", "p2", "p3"],
    });
    for (const id of ["p1", "p2"]) await online(t, "QASELX", id);
    await dropOut(t, "QASELX", "p3");

    for (const id of ["p1", "p2"]) {
      const res = await t.mutation(api.game.flow.submitSong, { code: "QASELX", playerId: id, connectionId: conn(id), ...track(id) });
      expect(res.success).toBe(true);
    }
    await advance(t, 0);
    expect((await room(t, "QASELX"))!.phase).toBe("songSelection"); // p3 might be refreshing
    await advance(t, PUBLIC_IN_GAME_GRACE_MS);
    expect((await room(t, "QASELX"))!.phase).toBe("rating");
  });

  test("the cron removes a player gone from a running game after the short in-game cutoff", async () => {
    const t = setup();
    await ratingRoom(t, "QAGONE", ["p1", "p2", "p3"], ["p1", "p2"]);
    await ratingRoom(t, "QAPRVG", ["v1", "v2"], ["v1"], false);
    for (const [code, id] of [["QAGONE", "p1"], ["QAGONE", "p2"], ["QAPRVG", "v1"]] as const) await online(t, code, id);
    await dropOut(t, "QAGONE", "p3");
    await dropOut(t, "QAPRVG", "v2");

    await advance(t, PUBLIC_IN_GAME_OFFLINE_MS - 5000);
    for (const [code, id] of [["QAGONE", "p1"], ["QAGONE", "p2"], ["QAPRVG", "v1"]] as const) await online(t, code, id);
    await t.mutation(internal.game.scheduler.cleanupInactivePlayers, {});
    expect(await players(t, "QAGONE")).toHaveLength(3);

    await advance(t, 10_000);
    for (const [code, id] of [["QAGONE", "p1"], ["QAGONE", "p2"], ["QAPRVG", "v1"]] as const) await online(t, code, id);
    await t.mutation(internal.game.scheduler.cleanupInactivePlayers, {});
    expect((await players(t, "QAGONE")).map((p) => p.playerId).sort()).toEqual(["p1", "p2"]);
    expect((await room(t, "QAGONE"))!.phase).toBe("rating");
    // Private rooms keep their long grace window.
    expect(await players(t, "QAPRVG")).toHaveLength(2);
  });
});

describe("ghosts (closed or abandoned tabs)", () => {
  const heartbeat = (t: T, code: string, id: string) =>
    t.mutation(api.presence.heartbeat, { roomId: code, userId: id, sessionId: `s-${id}`, interval: 30_000 });
  async function goOffline(t: T, code: string, id: string) {
    const tokens = await heartbeat(t, code, id);
    await t.mutation(api.presence.disconnect, { sessionToken: tokens.sessionToken });
  }

  test("the in-game grace is 45s and the waiting window 3 minutes", () => {
    expect(PUBLIC_IN_GAME_GRACE_MS).toBe(45_000);
    expect(PUBLIC_WAITING_TIMEOUT_MS).toBe(3 * 60 * 1000);
  });

  test("placement skips a lobby whose players all went quiet and prefers live players", async () => {
    const t = setup();
    await insertRoom(t, "QAGHST", { playerIds: ["g1", "g2"] });
    await goOffline(t, "QAGHST", "g1");
    await goOffline(t, "QAGHST", "g2");
    await insertRoom(t, "QALIVE", { playerIds: ["l1"] });
    await advance(t, PLACEMENT_RECENT_MS + 1000);
    await heartbeat(t, "QALIVE", "l1");
    // QAGHST has more seats taken, but nobody in it is there.
    expect((await join(t, "p1")).code).toBe("QALIVE");

    await insertRoom(t, "QAONLY", { playerIds: ["o1", "o2"] });
    await goOffline(t, "QAONLY", "o1");
    await goOffline(t, "QAONLY", "o2");
    await advance(t, PLACEMENT_RECENT_MS + 1000);
    await heartbeat(t, "QALIVE", "l1");
    await heartbeat(t, "QALIVE", "p1");
    const res = await join(t, "p2");
    expect(res.code).toBe("QALIVE");
    // With only ghost rooms open, a newcomer gets a fresh room.
    for (const id of ["l1", "p1", "p2"]) await leave(t, "QALIVE", id);
    const solo = await join(t, "p9");
    expect(["QAGHST", "QAONLY"]).not.toContain(solo.code);
  });

  test("a recently disconnected player still counts as live for placement", async () => {
    const t = setup();
    await insertRoom(t, "QARCNT", { playerIds: ["r1"] });
    await goOffline(t, "QARCNT", "r1"); // e.g. switched tabs a moment ago
    await advance(t, PLACEMENT_RECENT_MS - 5000);
    expect((await join(t, "p1")).code).toBe("QARCNT");
  });

  test("waitingCount counts online players and players not yet heartbeating, not offline ones", async () => {
    const t = setup();
    const { code } = await join(t, "p1");
    await join(t, "p2");
    await join(t, "p3");
    await heartbeat(t, code, "p1");
    await goOffline(t, code, "p2");
    // p1 online, p2 offline, p3 has no presence entry yet.
    expect(await t.query(api.quickPlay.waitingCount, {})).toEqual({ waiting: 2 });
  });

  test("leaveGame from a closing tab releases a public seat after a short delay", async () => {
    const t = setup();
    const { code } = await join(t, "p1");
    await join(t, "p2");
    await heartbeat(t, code, "p1");
    await goOffline(t, code, "p2"); // presence disconnect beacon from the closing tab
    const res = await t.mutation(api.game.rooms.leaveGame, {
      code,
      playerId: "p2",
      connectionId: conn("p2"),
      onClose: true,
    });
    expect(res).toMatchObject({ deferred: true });
    expect(await players(t, code)).toHaveLength(2);
    await advance(t, CLOSE_LEAVE_DELAY_MS);
    expect((await players(t, code)).map((p) => p.playerId)).toEqual(["p1"]);
    await advance(t, 0);
    expect(await events(t, "quickplay_left_waiting")).toHaveLength(1);
  });

  test("a reload keeps the seat: the page came back and resumed it", async () => {
    const t = setup();
    const { code } = await join(t, "p1");
    await join(t, "p2");
    await t.mutation(api.game.rooms.leaveGame, { code, playerId: "p2", connectionId: conn("p2"), onClose: true });
    expect(await t.mutation(api.quickPlay.resumeSeat, { code, playerId: "p2", connectionId: conn("p2") })).toEqual({
      success: true,
    });
    await advance(t, CLOSE_LEAVE_DELAY_MS);
    expect(await players(t, code)).toHaveLength(2);
    expect((await players(t, code)).every((p) => p.closingAt === undefined)).toBe(true);
  });

  test("a close is not cancelled by a stale online presence session", async () => {
    const t = setup();
    const { code } = await join(t, "p1");
    await join(t, "p2");
    await heartbeat(t, code, "p2"); // a leftover session still reports online
    await t.mutation(api.game.rooms.leaveGame, { code, playerId: "p2", connectionId: conn("p2"), onClose: true });
    await advance(t, CLOSE_LEAVE_DELAY_MS);
    expect((await players(t, code)).map((p) => p.playerId)).toEqual(["p1"]);
  });

  test("only the seat's own connection can resume it", async () => {
    const t = setup();
    const { code } = await join(t, "p1");
    expect(
      await t.mutation(api.quickPlay.resumeSeat, { code, playerId: "p1", connectionId: "conn-stranger" })
    ).toMatchObject({ success: false });
  });

  test("a stale close does nothing once the seat moved to another tab", async () => {
    const t = setup();
    const { code } = await join(t, "p1");
    await join(t, "p2");
    await t.mutation(api.game.rooms.leaveGame, { code, playerId: "p2", connectionId: conn("p2"), onClose: true });
    await join(t, "p2", { connectionId: "conn-p2-new-tab" });
    await advance(t, CLOSE_LEAVE_DELAY_MS);
    expect(await players(t, code)).toHaveLength(2);
  });

  test("private rooms ignore onClose and leave at once, as before", async () => {
    const t = setup();
    const { code } = await t.mutation(api.game.rooms.hostGame, {});
    await t.mutation(api.game.rooms.joinGame, { code, playerId: "h", connectionId: "c-h", name: "QA-h" });
    await t.mutation(api.game.rooms.joinGame, { code, playerId: "g", connectionId: "c-g", name: "QA-g" });
    await t.mutation(api.game.rooms.leaveGame, { code, playerId: "g", connectionId: "c-g", onClose: true });
    expect((await players(t, code)).map((p) => p.playerId)).toEqual(["h"]);
  });
});
