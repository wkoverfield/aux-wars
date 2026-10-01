import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "./schema";
import { api, internal } from "./_generated/api";
import presenceComponent from "@convex-dev/presence/test";

// Private (hosted) rooms: the host gates and lifecycle every Quick Play change
// must leave untouched.

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

const conn = (id: string) => `conn-${id}`;
const as = (code: string, id: string) => ({ code, playerId: id, connectionId: conn(id) });

async function hostedRoom(t: T, ids: string[]) {
  const { code } = await t.mutation(api.game.rooms.hostGame, {});
  for (const id of ids) {
    const res = await t.mutation(api.game.rooms.joinGame, { ...as(code, id), name: `QA-${id}` });
    expect(res.success).toBe(true);
  }
  return code;
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

async function readyAll(t: T, code: string, ids: string[]) {
  for (const id of ids) await t.mutation(api.game.rooms.updatePlayerName, { ...as(code, id), isReady: true });
}

describe("private rooms keep their host", () => {
  test("the first joiner hosts; nothing Quick Play is set", async () => {
    const t = setup();
    const code = await hostedRoom(t, ["h", "g"]);
    const ps = await players(t, code);
    expect(ps.find((p) => p.playerId === "h")!.isHost).toBe(true);
    expect(ps.find((p) => p.playerId === "g")!.isHost).toBe(false);
    const r = (await room(t, code))!;
    expect(r.hostPlayerId).toBe(ps.find((p) => p.playerId === "h")!._id);
    expect(r.isPublic).toBeUndefined();
    expect(ps.every((p) => p.waitingSince === undefined)).toBe(true);
    const view = await t.query(api.game.rooms.getRoomByCode, { code });
    expect(view!.room).not.toHaveProperty("playerCap");
  });

  test("only the host starts, and only when everyone is ready", async () => {
    const t = setup();
    const code = await hostedRoom(t, ["h", "g"]);
    await readyAll(t, code, ["h", "g"]);
    await t.mutation(api.game.flow.startGame, as(code, "g"));
    expect((await room(t, code))!.phase).toBe("lobby");
    await t.mutation(api.game.rooms.updatePlayerName, { ...as(code, "g"), isReady: false });
    await t.mutation(api.game.flow.startGame, as(code, "h"));
    expect((await room(t, code))!.phase).toBe("lobby");
    await readyAll(t, code, ["g"]);
    await t.mutation(api.game.flow.startGame, as(code, "h"));
    const r = (await room(t, code))!;
    expect(r.phase).toBe("promptVoting");
    expect(r.startsAt).toBeUndefined();
  });

  test("only the host advances from results; no auto-advance", async () => {
    const t = setup();
    const code = await hostedRoom(t, ["h", "g"]);
    await t.run(async (ctx) => {
      const r = await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", code)).unique();
      await ctx.db.patch(r!._id, { phase: "results", currentRound: 1 });
    });
    await t.mutation(api.game.flow.nextRound, as(code, "g"));
    expect((await room(t, code))!.phase).toBe("results");
    await t.mutation(api.game.flow.nextRound, as(code, "h"));
    const r = (await room(t, code))!;
    expect(r.currentRound).toBe(2);
    expect(r.phase).toBe("promptVoting");
  });

  test("the last round's nextRound ends the game without arming a rematch", async () => {
    const t = setup();
    const code = await hostedRoom(t, ["h", "g"]);
    await t.run(async (ctx) => {
      const r = await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", code)).unique();
      await ctx.db.patch(r!._id, { phase: "results", currentRound: 3 });
    });
    await t.mutation(api.game.flow.nextRound, as(code, "h"));
    const r = (await room(t, code))!;
    expect(r.phase).toBe("gameOver");
    expect(r.rematchStartingAt).toBeUndefined();
  });

  test("only the host kicks, changes settings and locks", async () => {
    const t = setup();
    const code = await hostedRoom(t, ["h", "g", "x"]);
    const kick = (by: string, target: string) =>
      t.mutation(api.game.rooms.kickPlayer, { code, hostPlayerId: by, hostConnectionId: conn(by), targetPlayerId: target });
    expect(await kick("g", "x")).toMatchObject({ success: false });
    expect(await kick("h", "x")).toMatchObject({ success: true, roomDeleted: false });
    expect((await players(t, code)).map((p) => p.playerId)).toEqual(["h", "g"]);

    const settings = {
      numberOfRounds: 5,
      roundLength: 90,
      snippetDuration: 15,
      selectedPrompts: ["QA a", "QA b", "QA c", "QA d", "QA e"],
    };
    expect(await t.mutation(api.game.rooms.updateSettings, { ...as(code, "g"), ...settings })).toMatchObject({
      success: false,
    });
    expect(await t.mutation(api.game.rooms.updateSettings, { ...as(code, "h"), ...settings })).toMatchObject({
      success: true,
    });
    expect((await room(t, code))!.settings.numberOfRounds).toBe(5);

    expect(await t.mutation(api.game.rooms.setRoomLock, { ...as(code, "g"), locked: true })).toMatchObject({
      success: false,
    });
    expect(await t.mutation(api.game.rooms.setRoomLock, { ...as(code, "h"), locked: true })).toMatchObject({
      success: true,
    });
    expect(
      await t.mutation(api.game.rooms.joinGame, { ...as(code, "late"), name: "QA-late" })
    ).toMatchObject({ success: false, message: "This room is locked" });
  });

  test("custom prompts still work in private rooms", async () => {
    const t = setup();
    const code = await hostedRoom(t, ["h", "g"]);
    expect(
      await t.mutation(api.game.rooms.addCustomPrompt, { code, text: "QA custom", createdBy: "g" })
    ).toMatchObject({ success: true, added: 1 });
    expect(
      await t.mutation(api.game.rooms.addCustomPrompts, { code, prompts: ["QA two", "QA three"], createdBy: "h" })
    ).toMatchObject({ success: true, added: 2 });
    expect(await t.query(api.game.rooms.getCustomPrompts, { code })).toHaveLength(3);
  });

  test("returnToLobby is host-only mid-game and open to anyone after the game", async () => {
    const t = setup();
    const code = await hostedRoom(t, ["h", "g"]);
    const setPhase = (phase: "songSelection" | "gameOver") =>
      t.run(async (ctx) => {
        const r = await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", code)).unique();
        await ctx.db.patch(r!._id, { phase });
      });
    await setPhase("songSelection");
    await t.mutation(api.game.flow.returnToLobby, as(code, "g"));
    expect((await room(t, code))!.phase).toBe("songSelection");
    await t.mutation(api.game.flow.returnToLobby, as(code, "h"));
    expect((await room(t, code))!.phase).toBe("lobby");
    await setPhase("gameOver");
    await t.mutation(api.game.flow.returnToLobby, as(code, "g"));
    expect((await room(t, code))!.phase).toBe("lobby");
  });

  test("the rematch countdown can be started, cancelled and run by any player", async () => {
    const t = setup();
    const code = await hostedRoom(t, ["h", "g"]);
    await t.run(async (ctx) => {
      const r = await ctx.db.query("rooms").withIndex("by_code", (q) => q.eq("code", code)).unique();
      await ctx.db.patch(r!._id, { phase: "gameOver", currentRound: 3 });
    });
    await t.mutation(api.game.flow.startRematch, as(code, "g"));
    expect((await room(t, code))!.rematchStartingAt).toBeDefined();
    await t.mutation(api.game.flow.cancelRematch, as(code, "h"));
    expect((await room(t, code))!.rematchStartingAt).toBeUndefined();
    await t.mutation(api.game.flow.startRematch, as(code, "h"));
    const startAt = (await room(t, code))!.rematchStartingAt!;
    await t.mutation(internal.game.flow.executeRematch, { code, startAt });
    const r = (await room(t, code))!;
    expect(r.phase).toBe("promptVoting");
    expect(r.currentRound).toBe(1);
    expect(r.rematchStartingAt).toBeUndefined();
  });

  test("the host leaving hands the room to the next player; the last leave deletes it", async () => {
    const t = setup();
    const code = await hostedRoom(t, ["h", "g"]);
    await t.mutation(api.game.rooms.leaveGame, as(code, "h"));
    const [g] = await players(t, code);
    expect(g.isHost).toBe(true);
    expect((await room(t, code))!.hostPlayerId).toBe(g._id);
    expect(await t.mutation(api.game.rooms.leaveGame, as(code, "g"))).toMatchObject({ roomDeleted: true });
    expect(await room(t, code)).toBeNull();
  });
});
