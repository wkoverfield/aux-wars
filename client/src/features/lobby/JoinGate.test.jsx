import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const joinGame = vi.fn();
vi.mock("convex/react", () => ({ useMutation: () => joinGame }));
const showToast = vi.fn();
vi.mock("../../contexts/ToastContext", () => ({ useToast: () => ({ showToast }) }));
const captureGameEvent = vi.fn();
vi.mock("../../services/analytics", () => ({
  captureGameEvent: (...args) => captureGameEvent(...args),
  hashRoomCode: (code) => `hash-${code}`,
}));

const { default: JoinGate } = await import("./JoinGate");
const { joinGateCopy } = await import("./joinGateCopy");
const { useSession, _resetSessionStoreForTests } = await import("../../hooks/useSession");

const room = (over = {}) => ({ phase: "lobby", ...over });
const players = [{ name: "Maya", isHost: true }, { name: "Dev", isHost: false }];

function SessionProbe() {
  const { session } = useSession();
  return <div data-testid="session">{session ? `${session.gameCode}:${session.playerName}` : "none"}</div>;
}

const renderGate = (props = {}) =>
  render(
    <MemoryRouter>
      <JoinGate code="ABC123" room={room()} players={players} {...props} />
      <SessionProbe />
    </MemoryRouter>
  );

describe("joinGateCopy", () => {
  it("names the host and the head count", () => {
    expect(joinGateCopy(room(), players)).toEqual({
      canJoin: true,
      title: "Join Maya's game",
      detail: "2 players in the room. Pick a name to jump in.",
    });
    expect(joinGateCopy(room({ phase: "rating" }), [players[0]]).detail).toBe(
      "1 player in the room, game in progress. Pick a name to jump in."
    );
    expect(joinGateCopy(room(), []).title).toBe("Join this game");
    // A host who has not typed a name yet is not named.
    expect(joinGateCopy(room(), [{ name: "Host", isHost: true }]).title).toBe("Join this game");
    expect(joinGateCopy(room(), [{ name: "Player 42", isHost: true }]).title).toBe("Join this game");
    expect(joinGateCopy(room(), [{ name: "Hostess", isHost: true }]).title).toBe("Join Hostess's game");
  });

  it("explains rooms a link cannot seat anyone in", () => {
    expect(joinGateCopy(room({ locked: true }), players)).toMatchObject({ canJoin: false, title: "This room is locked" });
    expect(joinGateCopy(room({ isPublic: true }), players)).toMatchObject({ canJoin: false, title: "This is a Quick Play game" });
  });
});

describe("JoinGate", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    _resetSessionStoreForTests();
    joinGame.mockReset();
    showToast.mockReset();
    captureGameEvent.mockReset();
  });
  afterEach(cleanup);

  it("joins by link with the typed name and creates the session", async () => {
    joinGame.mockResolvedValue({ success: true });
    renderGate();
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "  Sam  " } });
    fireEvent.click(screen.getByRole("button", { name: "Join game" }));

    await waitFor(() => expect(screen.getByTestId("session").textContent).toBe("ABC123:Sam"));
    expect(joinGame).toHaveBeenCalledTimes(1);
    expect(joinGame.mock.calls[0][0]).toMatchObject({ code: "ABC123", name: "Sam", source: "link" });
    expect(joinGame.mock.calls[0][0].playerId).toBeTruthy();
    expect(captureGameEvent).toHaveBeenCalledWith("player_joined", expect.objectContaining({ join_source: "link" }));
  });

  it("asks for a name before calling the server", () => {
    renderGate();
    fireEvent.click(screen.getByRole("button", { name: "Join game" }));
    expect(screen.getByRole("alert").textContent).toBe("Enter a name to join.");
    expect(joinGame).not.toHaveBeenCalled();
  });

  it("shows the server's reason and creates no session when the join is refused", async () => {
    joinGame.mockResolvedValue({ success: false, message: "Room is full (max 8 players)" });
    renderGate();
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Sam" } });
    fireEvent.click(screen.getByRole("button", { name: "Join game" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Room is full (max 8 players)"));
    expect(screen.getByTestId("session").textContent).toBe("none");
    expect(screen.getByRole("button", { name: "Join game" }).disabled).toBe(false);
  });

  it("toasts and stays put when the server cannot be reached", async () => {
    joinGame.mockRejectedValue(new Error("offline"));
    renderGate();
    fireEvent.change(screen.getByLabelText("Your name"), { target: { value: "Sam" } });
    fireEvent.click(screen.getByRole("button", { name: "Join game" }));

    await waitFor(() => expect(showToast).toHaveBeenCalledWith("Couldn't reach the game. Please try again.", "error"));
    expect(screen.getByTestId("session").textContent).toBe("none");
  });

  it("offers no join form for a locked or Quick Play room", () => {
    renderGate({ room: room({ locked: true }) });
    expect(screen.getByText("This room is locked")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Join game" })).toBeNull();
    expect(screen.getByRole("button", { name: "Go to the home page" })).toBeTruthy();
  });
});
