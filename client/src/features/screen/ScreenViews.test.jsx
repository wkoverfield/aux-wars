import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("convex/react", () => ({ useQuery: () => undefined }));
let playerProps = null;
vi.mock("../../components/TrackPlayer", () => ({
  default: (props) => {
    playerProps = props;
    return <div data-testid="player" />;
  },
}));

const { ScreenRating, ScreenSelection } = await import("./ScreenViews");

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

describe("ScreenRating sources", () => {
  afterEach(() => {
    cleanup();
    playerProps = null;
  });

  const cover = "https://i1.sndcdn.com/a.jpg";
  const base = { songId: "s1", name: "Flickermood", artist: "Forss", albumCover: cover, player: { name: "Kay" } };
  const renderRating = (song) =>
    render(<ScreenRating code="ABC123" room={room(false)} song={{ ...base, ...song }} audioOn />);
  const albumArt = () => screen.queryByAltText("Flickermood album art");
  const playerBox = () => screen.getByTestId("player").parentElement;
  const column = () => screen.getByTestId("player").closest("[data-vital='screen-rating'] > div");

  it("plays a SoundCloud song in its own player box at the wide width", () => {
    renderRating({ soundcloudUrl: "https://soundcloud.com/forss/flickermood", snippet: { startTime: 30, endTime: 45 } });
    expect(playerProps).toMatchObject({
      soundcloudUrl: "https://soundcloud.com/forss/flickermood",
      name: "Flickermood",
      artist: "Forss",
      artwork: cover,
      startTime: 30,
      endTime: 45,
      autoPlay: true,
      showControls: false,
    });
    expect(albumArt()).toBeNull();
    expect(playerBox().className).toBe("w-full");
    expect(column().className).toContain("w-[620px]");
  });

  it("keeps the YouTube layout", () => {
    renderRating({ videoId: "v1", snippet: { startTime: 10, endTime: 40 } });
    expect(playerProps).toMatchObject({ videoId: "v1", startTime: 10, endTime: 40 });
    expect(albumArt()).toBeNull();
    expect(playerBox().className).toBe("w-full");
    expect(column().className).toContain("w-[620px]");
  });

  it("shows the cover for a preview and keeps its audio player out of sight", () => {
    renderRating({ previewUrl: "https://example.com/p.m4a" });
    expect(playerProps).toMatchObject({ src: "https://example.com/p.m4a" });
    expect(albumArt()).toBeTruthy();
    expect(playerBox().className).toBe("hidden");
    expect(column().className).toContain("w-[440px]");
  });
});
