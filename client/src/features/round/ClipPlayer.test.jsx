import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("convex/react", () => ({ useMutation: () => vi.fn(async () => {}) }));
vi.mock("../../contexts/ToastContext", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../../components/ScrollFade", () => ({ default: ({ children }) => <div>{children}</div> }));

let playerRenders = 0;
let playerProps = null;
vi.mock("../../components/TrackPlayer", () => ({
  default: (props) => {
    playerRenders += 1;
    playerProps = props;
    return <div data-testid="player" />;
  },
}));

const { default: RatingScreen } = await import("./RatingScreen");
const { default: ClipPlayer } = await import("./ClipPlayer");

const song = (songId) => ({ songId, name: "Track", artist: "A", videoId: "v1", snippet: { startTime: 10, endTime: 40 } });
const soundcloudSong = (songId) => ({
  songId,
  name: "Flickermood",
  artist: "Forss",
  albumCover: "https://i1.sndcdn.com/a.jpg",
  soundcloudUrl: "https://soundcloud.com/forss/flickermood",
  snippet: { startTime: 30, endTime: 45 },
});
const screenProps = { currentPrompt: "p", onSubmitRating: () => {}, currentIndex: 0, totalSongs: 2 };

describe("ClipPlayer", () => {
  afterEach(() => {
    cleanup();
    playerRenders = 0;
    playerProps = null;
  });

  it("renders nothing without a playable source", () => {
    const { container } = render(<ClipPlayer startTime={0} endTime={0} />);
    expect(container.innerHTML).toBe("");
  });

  it("plays a SoundCloud clip window with the screen's own controls", () => {
    render(<RatingScreen {...screenProps} songToRate={soundcloudSong("s1")} />);
    expect(playerProps).toMatchObject({
      soundcloudUrl: "https://soundcloud.com/forss/flickermood",
      name: "Flickermood",
      artist: "Forss",
      artwork: "https://i1.sndcdn.com/a.jpg",
      startTime: 30,
      endTime: 45,
      autoPlay: true,
      loop: true,
      showControls: false, // the scrubber's play button is the control, as for YouTube
    });
    expect(playerProps.videoId).toBeUndefined();
    act(() => playerProps.onReady(15));
    act(() => playerProps.onTimeUpdate(7));
    expect(screen.getByLabelText("Clip playback position").value).toBe("7");
  });

  it("is not re-rendered by a rating tap on a SoundCloud clip", () => {
    render(<RatingScreen {...screenProps} songToRate={soundcloudSong("s1")} />);
    const before = playerRenders;
    fireEvent.click(screen.getByAltText("rate this song 4 records"));
    expect(playerRenders).toBe(before);
  });

  it("is not re-rendered by a rating tap on the screen around it", () => {
    render(<RatingScreen {...screenProps} songToRate={song("s1")} />);
    const before = playerRenders;
    fireEvent.click(screen.getByAltText("rate this song 4 records"));
    fireEvent.click(screen.getByAltText("rate this song 2 records"));
    expect(playerRenders).toBe(before);
  });

  it("keeps playback ticks to itself and shows them on the scrubber", () => {
    render(<RatingScreen {...screenProps} songToRate={song("s1")} />);
    act(() => playerProps.onReady(30));
    act(() => playerProps.onTimeUpdate(12));
    expect(screen.getByLabelText("Clip playback position").value).toBe("12");
    expect(screen.getByText("0:12")).toBeTruthy();
  });

  it("starts fresh for the next song", () => {
    const { rerender } = render(<RatingScreen {...screenProps} songToRate={song("s1")} />);
    act(() => playerProps.onReady(30));
    expect(screen.queryByLabelText("Clip playback position")).toBeTruthy();
    rerender(<RatingScreen {...screenProps} songToRate={song("s2")} />);
    // A new player instance: no duration yet, so no scrubber until it is ready.
    expect(screen.queryByLabelText("Clip playback position")).toBeNull();
  });
});
