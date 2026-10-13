import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

let result;
const logEvent = vi.fn(async () => ({ success: true }));
vi.mock("convex/react", () => ({
  useQuery: (_ref, args) => (args === "skip" ? undefined : result),
  useMutation: () => logEvent,
}));
vi.mock("../../components/ScrollFade", () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock("../../components/PlayerResultWithHover", () => ({
  default: ({ playerName, wins }) => <span>{playerName}: {wins}</span>,
}));

const { default: SharedResults } = await import("./SharedResults");

const song = (id, key, name, totalRecords) => ({ songId: id, name: `Song ${id}`, artist: "A", albumCover: "", totalRecords, player: { id: key, name } });
const snapshot = {
  seed: 12345,
  createdAt: 1,
  players: [{ playerId: "p1", name: "Maya" }, { playerId: "p2", name: "Dev" }],
  rounds: [
    { round: 1, prompt: "Prompt 1", winnerSongId: "r1s1", songs: [song("r1s1", "p1", "Maya", 9), song("r1s2", "p2", "Dev", 6)] },
    { round: 2, prompt: "Prompt 2", winnerSongId: "r2s1", songs: [song("r2s1", "p1", "Maya", 8), song("r2s2", "p2", "Dev", 7)] },
  ],
  voterAwards: [],
};

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/g/abcdefgh2345"]}>
      <Routes>
        <Route path="/g/:shareId" element={<SharedResults />} />
        <Route path="/" element={<div>home page</div>} />
      </Routes>
    </MemoryRouter>
  );

describe("SharedResults", () => {
  beforeEach(() => {
    logEvent.mockClear();
    document.head.querySelector('meta[name="robots"]')?.remove();
  });
  afterEach(cleanup);

  it("shows the winner, the standings and one action to host a game", () => {
    result = snapshot;
    renderPage();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Maya had the best taste");
    expect(screen.getByText("2 players, 2 rounds")).toBeTruthy();
    expect(screen.getByText("Maya: 2")).toBeTruthy();
    expect(screen.getByText("Dev: 0")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Host your own game" }));
    expect(screen.getByText("home page")).toBeTruthy();
  });

  it("lists a player who rated but never submitted a song, after the ranked players", () => {
    result = {
      ...snapshot,
      players: [...snapshot.players, { playerId: "p3", name: "Sam" }],
      voterAwards: [{ voterId: "p3", avgGiven: 2, count: 4, kingmakerHits: 0 }],
    };
    renderPage();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Maya had the best taste");
    expect(screen.getByText("3 players, 2 rounds")).toBeTruthy();
    const seats = screen.getAllByRole("button", { name: /setlist$/ }).map((b) => b.getAttribute("aria-label"));
    expect(seats).toEqual(["View Maya's setlist", "View Dev's setlist", "View Sam's setlist"]);
    expect(screen.getByText("Sam: 0")).toBeTruthy();
  });

  it("is kept out of search indexes and counts one view", () => {
    result = snapshot;
    renderPage();
    expect(document.head.querySelector('meta[name="robots"]').getAttribute("content")).toBe("noindex, nofollow");
    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledWith({ eventType: "result_viewed" });
  });

  it("explains a missing or expired link and counts no view", () => {
    result = null;
    renderPage();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("These results aren't available");
    expect(screen.getByRole("button", { name: "Host your own game" })).toBeTruthy();
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("shows a loading state while the results are fetched", () => {
    result = undefined;
    renderPage();
    expect(screen.getByRole("status")).toBeTruthy();
  });
});
