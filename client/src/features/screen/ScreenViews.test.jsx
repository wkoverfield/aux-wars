import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("convex/react", () => ({ useQuery: () => undefined }));
vi.mock("../../components/TrackPlayer", () => ({ default: () => null }));

const { ScreenSelection } = await import("./ScreenViews");
const { default: ScreenLinkModal } = await import("../lobby/ScreenLinkModal");

const players = [
  { playerId: "a", name: "Ana", submittedRounds: [1] },
  { playerId: "b", name: "Bo", submittedRounds: [] },
];
const room = (anonymousMode) => ({ currentRound: 1, currentPrompt: "p", settings: { numberOfRounds: 3, anonymousMode } });

describe("ScreenSelection", () => {
  afterEach(cleanup);

  it("names who has picked in a normal room", () => {
    render(<ScreenSelection room={room(false)} players={players} />);
    expect(screen.getByText("1 of 2 picked")).toBeTruthy();
    expect(screen.getByText("Ana")).toBeTruthy();
    expect(screen.getByText("Bo")).toBeTruthy();
  });

  it("shows only the count in an anonymous room", () => {
    render(<ScreenSelection room={room(true)} players={players} />);
    expect(screen.getByText("1 of 2 picked")).toBeTruthy();
    expect(screen.queryByText("Ana")).toBeNull();
    expect(screen.queryByText("Bo")).toBeNull();
  });
});

describe("ScreenLinkModal", () => {
  afterEach(cleanup);

  it("shows the screen address as text, not a link this phone could open", () => {
    render(<ScreenLinkModal code="ABC123" onCopy={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByTestId("screen-url").textContent).toMatch(/\/screen\/ABC123$/);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeTruthy();
  });
});
