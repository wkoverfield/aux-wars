import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { getFunctionName } from "convex/server";

const queryResults = {};
const mutations = {};
const showToast = vi.fn();

function mutationFor(name) {
  if (!mutations[name]) mutations[name] = vi.fn(async () => ({ code: "OK" }));
  return mutations[name];
}

vi.mock("convex/react", () => ({
  useQuery: (ref, args) => (args === "skip" ? undefined : queryResults[getFunctionName(ref)]),
  useMutation: (ref) => mutationFor(getFunctionName(ref)),
}));
vi.mock("../../hooks/useSession", () => ({
  useSession: () => ({
    session: { playerId: "p1", connectionId: "c1", playerName: "Wil" },
    clearSession: vi.fn(),
    updateSession: vi.fn(),
  }),
}));
vi.mock("../../hooks/useHeartbeat", () => ({ useHeartbeat: () => {} }));
vi.mock("../../contexts/ToastContext", () => ({ useToast: () => ({ showToast }) }));
vi.mock("../../services/analytics", () => ({
  captureGameEvent: vi.fn(),
  gameProperties: vi.fn(() => ({})),
}));
vi.mock("../../services/RoomProvider", () => ({
  useRoom: () => ({ room: { isPublic: false }, loading: false }),
}));
vi.mock("../../components/ScrollFade", () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock("../../components/AdSlot", () => ({ default: () => null }));
vi.mock("../../components/SettingsModal", () => ({ default: () => null }));
vi.mock("../../components/SettingsPreview", () => ({ default: () => null }));
vi.mock("../../components/SessionTakenOverModal", () => ({ default: () => null }));
vi.mock("../quickplay/PublicLobby", () => ({ default: () => null }));

const { default: Lobby } = await import("./Lobby");

const UPDATE = "game/rooms:updatePlayerName";

function setPlayers(me) {
  queryResults["game/rooms:getPlayers"] = [
    { playerId: "p1", name: "Wil", isHost: true, isReady: false, ...me },
    { playerId: "p2", name: "Kay", isHost: false, isReady: true },
  ];
}

function ui() {
  return (
    <MemoryRouter initialEntries={["/lobby/ABC123"]}>
      <Routes>
        <Route path="/lobby/:gameCode" element={<Lobby />} />
      </Routes>
    </MemoryRouter>
  );
}

const readyButton = () => screen.getByRole("button", { name: /Ready/ });

describe("Lobby ready and nickname", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    for (const key of Object.keys(mutations)) delete mutations[key];
    showToast.mockClear();
    queryResults["game/rooms:getRoomByCode"] = { room: { settings: {} } };
    setPlayers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("does not write on mount when the name matches the server", async () => {
    render(ui());
    await act(async () => { vi.advanceTimersByTime(1000); });
    expect(mutationFor(UPDATE)).not.toHaveBeenCalled();
  });

  it("sends Ready immediately as an isReady-only write and shows it optimistically", async () => {
    render(ui());
    await act(async () => { fireEvent.click(readyButton()); });
    expect(mutationFor(UPDATE)).toHaveBeenCalledTimes(1);
    expect(mutationFor(UPDATE)).toHaveBeenCalledWith({
      code: "ABC123", playerId: "p1", connectionId: "c1", isReady: true,
    });
    expect(readyButton().textContent).toBe("Ready");
  });

  it("keeps Ready when the player types a name after tapping it", async () => {
    const { rerender } = render(ui());
    await act(async () => { fireEvent.click(readyButton()); });
    // Server confirms the Ready tap.
    setPlayers({ isReady: true });
    rerender(ui());

    fireEvent.change(screen.getByLabelText("Nickname"), { target: { value: "Wilson " } });
    await act(async () => { vi.advanceTimersByTime(300); });

    const calls = mutationFor(UPDATE).mock.calls.map(([args]) => args);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual({ code: "ABC123", playerId: "p1", connectionId: "c1", name: "Wilson" });
    expect("isReady" in calls[1]).toBe(false);
    expect(readyButton().textContent).toBe("Ready");
  });

  it("keeps the optimistic Ready while the server still shows the old value", async () => {
    const { rerender } = render(ui());
    await act(async () => { fireEvent.click(readyButton()); });
    rerender(ui()); // server row still isReady: false
    expect(readyButton().textContent).toBe("Ready");
  });

  it("shows the server Ready state after a reload", () => {
    setPlayers({ isReady: true });
    render(ui());
    expect(readyButton().textContent).toBe("Ready");
  });

  it("reverts the Ready tap when the server refuses it", async () => {
    mutationFor(UPDATE).mockResolvedValueOnce({ code: "CONNECTION_TAKEN_OVER" });
    render(ui());
    await act(async () => { fireEvent.click(readyButton()); });
    expect(readyButton().textContent).toBe("Not Ready");
  });

  it("debounces name saves and saves at once on blur without resending", async () => {
    render(ui());
    const input = screen.getByLabelText("Nickname");
    fireEvent.change(input, { target: { value: "Wi" } });
    fireEvent.change(input, { target: { value: "Wilso" } });
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(mutationFor(UPDATE)).not.toHaveBeenCalled();

    await act(async () => { fireEvent.blur(input); });
    expect(mutationFor(UPDATE)).toHaveBeenCalledTimes(1);
    expect(mutationFor(UPDATE).mock.calls[0][0].name).toBe("Wilso");

    await act(async () => { vi.advanceTimersByTime(1000); fireEvent.blur(input); });
    expect(mutationFor(UPDATE)).toHaveBeenCalledTimes(1);
  });

  it("saves on Enter and skips a name equal to the server name", async () => {
    render(ui());
    const input = screen.getByLabelText("Nickname");
    fireEvent.change(input, { target: { value: " Wil " } });
    await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); });
    expect(mutationFor(UPDATE)).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "Kay2" } });
    await act(async () => { fireEvent.keyDown(input, { key: "Enter" }); });
    expect(mutationFor(UPDATE)).toHaveBeenCalledTimes(1);
  });
});
