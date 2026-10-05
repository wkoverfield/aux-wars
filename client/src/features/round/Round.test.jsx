import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
vi.mock("./RatingScreen", () => ({ default: () => <div>rating screen</div> }));
vi.mock("./RoundStart", () => ({ default: () => <div>round start</div> }));
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
      "game/rooms:getRoomByCode": { phase: "selecting", currentRound: 1, settings: {} },
      "game/flow:getCurrentRatingSong": null,
      "game/flow:getMySubmission": null,
    });
    renderRound();
    expect(screen.getByText("round start")).toBeTruthy();
  });
});
