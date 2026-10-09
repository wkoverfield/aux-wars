import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { getFunctionName } from "convex/server";

const queryResults = {};
const mutation = vi.fn(async () => ({ success: true }));

vi.mock("convex/react", () => ({
  useQuery: (ref, args) => (args === "skip" ? undefined : queryResults[getFunctionName(ref)]),
  useMutation: () => mutation,
}));
vi.mock("../../hooks/useSession", () => ({
  useSession: () => ({
    session: { playerId: "p1", connectionId: "c1" },
    clearSession: vi.fn(),
    connectionId: "c1",
    updateSession: vi.fn(),
  }),
}));
vi.mock("../../hooks/useHeartbeat", () => ({ useHeartbeat: () => {} }));
vi.mock("../../contexts/ToastContext", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../../services/analytics", () => ({
  captureGameEvent: vi.fn(),
  gameProperties: vi.fn(() => ({})),
}));
vi.mock("./RatingScreen", () => ({
  default: ({ onSubmitRating, songToRate }) => (
    <button onClick={() => onSubmitRating(songToRate.songId, 4)}>rating screen</button>
  ),
}));
vi.mock("./RoundStart", () => ({
  default: ({ onStartSelection }) => <button onClick={onStartSelection}>round start</button>,
}));
vi.mock("./SongSelection", () => ({
  default: ({ onSelectSong, onSelectionChange }) => (
    <>
      <button onClick={() => onSelectSong({ id: "t1", name: "Track", artists: [{ name: "A" }] })}>pick track</button>
      {!onSelectionChange && <span>selection locked</span>}
    </>
  ),
}));
vi.mock("../../components/SnippetSelector", () => ({
  default: ({ onConfirm, track }) => (
    <button onClick={() => onConfirm({ ...track, snippet: null })}>confirm snippet</button>
  ),
}));
vi.mock("./WaitingScreen", () => ({ default: ({ message }) => <div>{message}</div> }));

const { default: Round } = await import("./Round");

function renderRound() {
  return render(
    <MemoryRouter initialEntries={["/lobby/ABC123/round"]}>
      <Routes>
        <Route path="/lobby/:gameCode/round" element={<Round />} />
      </Routes>
    </MemoryRouter>,
  );
}

function setQueries(values) {
  for (const key of Object.keys(queryResults)) delete queryResults[key];
  Object.assign(queryResults, values);
}

describe("Round rating phase", () => {
  beforeEach(() => mutation.mockClear());
  afterEach(cleanup);

  it("shows Tallying instead of the selection screens when rating has no song yet", () => {
    setQueries({
      "game/rooms:getRoomByCode": { phase: "rating", currentRound: 1, settings: { roundLength: 60 }, selectionStartedAt: Date.now() },
      "game/flow:getCurrentRatingSong": null,
      "game/flow:getMySubmission": null,
      "game/flow:getSubmissionStatus": { submitted: 3, total: 3 },
    });
    renderRound();
    expect(screen.getByText("Tallying...")).toBeTruthy();
    expect(screen.queryByText("round start")).toBeNull();
    expect(screen.queryByText(/Waiting for other players to submit/)).toBeNull();
    expect(screen.queryByText(/⏱/)).toBeNull();
  });

  it("shows the rating screen once the song arrives", () => {
    setQueries({
      "game/rooms:getRoomByCode": { phase: "rating", currentRound: 1, settings: {} },
      "game/flow:getCurrentRatingSong": { songId: "s1", name: "Song", artist: "A", player: { id: "p2" } },
      "game/flow:getMySubmission": { _id: "x" },
    });
    renderRound();
    expect(screen.getByText("rating screen")).toBeTruthy();
    expect(screen.queryByText("Tallying...")).toBeNull();
  });

  it("keeps the selection screens during song selection", () => {
    setQueries({
      "game/rooms:getRoomByCode": { phase: "songSelection", currentRound: 1, settings: {} },
      "game/flow:getCurrentRatingSong": null,
      "game/flow:getMySubmission": null,
    });
    renderRound();
    expect(screen.getByText("round start")).toBeTruthy();
  });

  it("shows the waiting screen at once on rating submit and reverts on refusal", async () => {
    setQueries({
      "game/rooms:getRoomByCode": { phase: "rating", currentRound: 1, settings: {} },
      "game/flow:getCurrentRatingSong": { songId: "s1", name: "Song", artist: "A", player: { id: "p2" } },
      "game/flow:getMySubmission": { _id: "x" },
    });
    let resolve;
    mutation.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    renderRound();
    fireEvent.click(screen.getByText("rating screen"));
    expect(screen.getByText(/Waiting for other players to rate/)).toBeTruthy();
    await act(async () => { resolve({ success: false, message: "nope" }); });
    expect(screen.getByText("rating screen")).toBeTruthy();
  });
});

describe("Round song submit", () => {
  beforeEach(() => mutation.mockReset());
  afterEach(cleanup);

  function openSnippetSelector() {
    setQueries({
      "game/rooms:getRoomByCode": { phase: "songSelection", currentRound: 1, settings: {} },
      "game/flow:getCurrentRatingSong": null,
      "game/flow:getMySubmission": null,
    });
    renderRound();
    fireEvent.click(screen.getByText("round start"));
    fireEvent.click(screen.getByText("pick track"));
  }

  it("closes the snippet selector before the submit resolves and reopens it on failure", async () => {
    let resolve;
    mutation.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    openSnippetSelector();
    fireEvent.click(screen.getByText("confirm snippet"));
    expect(screen.queryByText("confirm snippet")).toBeNull();
    await act(async () => { resolve({ success: false, message: "Song already taken" }); });
    expect(screen.getByText("confirm snippet")).toBeTruthy();
  });

  it("keeps the selector closed after a successful submit", async () => {
    mutation.mockResolvedValueOnce({ success: true });
    openSnippetSelector();
    await act(async () => { fireEvent.click(screen.getByText("confirm snippet")); });
    expect(screen.queryByText("confirm snippet")).toBeNull();
  });
});

describe("Round selection timer", () => {
  const START = 1_000_000;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    mutation.mockReset();
    mutation.mockResolvedValue({ success: true });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const songSubmits = () => mutation.mock.calls.filter(([args]) => args?.trackId);

  it("locks at 3s and auto-submits the open selection once at 2s", async () => {
    setQueries({
      "game/rooms:getRoomByCode": { phase: "songSelection", currentRound: 1, selectionStartedAt: START, settings: { roundLength: 10 } },
      "game/flow:getCurrentRatingSong": null,
      "game/flow:getMySubmission": null,
    });
    renderRound();
    expect(screen.getByText(/0:10/)).toBeTruthy();
    fireEvent.click(screen.getByText("round start"));
    fireEvent.click(screen.getByText("pick track"));

    await act(async () => { vi.advanceTimersByTime(1015); });
    expect(screen.getByText(/0:09/)).toBeTruthy();

    await act(async () => { vi.advanceTimersByTime(5984); }); // 6.999s: 4s left
    expect(screen.queryByText("selection locked")).toBeNull();
    await act(async () => { vi.advanceTimersByTime(16); }); // 7.015s: 3s left
    expect(screen.getByText("selection locked")).toBeTruthy();
    expect(songSubmits()).toHaveLength(0);

    await act(async () => { vi.advanceTimersByTime(1000); }); // 8.015s: 2s left
    expect(songSubmits()).toHaveLength(1);
    expect(songSubmits()[0][0].trackId).toBe("t1");

    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(songSubmits()).toHaveLength(1);
  });
});
