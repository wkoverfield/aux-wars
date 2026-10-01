import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import presenceComponent from "@convex-dev/presence/test";
import type { Doc } from "./_generated/dataModel";
import { CURATED_PROMPTS } from "./game/promptPacks";
import {
  AUTO_ADVANCE_MS,
  AUTO_REMATCH_MS,
  COUNTDOWN_MS,
  ONE_V_ONE_OFFER_MS,
  PUBLIC_WAITING_TIMEOUT_MS,
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

async function join(t: T, playerId: string, extra: { name?: string; connectionId?: string } = {}) {
  const res = await t.mutation(api.quickPlay.join, {
    playerId,
    connectionId: extra.connectionId ?? conn(playerId),
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
    const slur = await t.mutation(api.quickPlay.join, { playerId: "p2", connectionId: "c2", name: "faggot" });
    expect(slur.success).toBe(false);
    const long = await t.mutation(api.quickPlay.join, { playerId: "p3", connectionId: "c3", name: "x".repeat(51) });
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
    expect((await room(t, code))!.startVotes).toEqual(["p1"]);
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
      await t.mutation(api.game.rooms.joinGame, { code, playerId: "p2", connectionId: "conn-p2-b", name: "QA-p2" })
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
    const kick = (voter: string) =>
      t.mutation(api.quickPlay.voteKick, { code, playerId: voter, connectionId: conn(voter), targetPlayerId: "p4" });

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
      targetPlayerId: "p2",
    });
    expect(res.success).toBe(false);
    const self = await t.mutation(api.quickPlay.voteKick, {
      code,
      playerId: "p1",
      connectionId: conn("p1"),
      targetPlayerId: "p1",
    });
    expect(self.success).toBe(false);
    expect(await players(t, code)).toHaveLength(2);
  });

  test("votes from or against players who left are dropped", async () => {
    const t = setup();
    const { code } = await join(t, "p1");
    for (const id of ["p2", "p3", "p4", "p5"]) await join(t, id);
    await t.mutation(api.quickPlay.voteKick, { code, playerId: "p1", connectionId: conn("p1"), targetPlayerId: "p5" });
    await t.mutation(api.quickPlay.voteKick, { code, playerId: "p2", connectionId: conn("p2"), targetPlayerId: "p4" });
    await leave(t, code, "p1");
    expect((await room(t, code))!.kickVotes).toEqual([{ targetPlayerId: "p4", voterIds: ["p2"] }]);
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
    const { code } = await join(t, "p3");
    const tokens = await t.mutation(api.presence.heartbeat, {
      roomId: code,
      userId: "p3",
      sessionId: "s3",
      interval: 30_000,
    });
    await t.mutation(api.presence.disconnect, { sessionToken: tokens.sessionToken });
    await advance(t, PUBLIC_WAITING_TIMEOUT_MS);
    await join(t, "p1");
    await join(t, "p2");
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
