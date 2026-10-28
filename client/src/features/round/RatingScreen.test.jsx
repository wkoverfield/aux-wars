import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("convex/react", () => ({ useMutation: () => vi.fn(async () => {}) }));
vi.mock("../../contexts/ToastContext", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../../components/TrackPlayer", () => ({ default: () => null }));
vi.mock("../../components/ScrollFade", () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock("./ClipPlayer", () => ({ default: () => <div data-testid="clip-player" /> }));

const { default: RatingScreen } = await import("./RatingScreen");

const song = (id) => ({ songId: id, name: `Song ${id}`, artist: "A", player: { id: "p2", name: "Kay" } });

function renderScreen(props = {}) {
  const onSubmitRating = vi.fn();
  const onAutoSubmit = vi.fn();
  const utils = render(
    <RatingScreen
      currentPrompt="prompt"
      songToRate={song("s1")}
      onSubmitRating={onSubmitRating}
      onAutoSubmit={onAutoSubmit}
      currentIndex={0}
      totalSongs={3}
      {...props}
    />,
  );
  return { ...utils, onSubmitRating, onAutoSubmit };
}

const disc = (n) => screen.getByAltText(`rate this song ${n} records`);
const submit = () => screen.getByRole("button", { name: "Submit" });

describe("RatingScreen submit", () => {
  afterEach(cleanup);

  it("blocks a double tap on Submit", () => {
    const { onSubmitRating } = renderScreen();
    fireEvent.click(disc(4));
    fireEvent.click(submit());
    fireEvent.click(submit());
    expect(onSubmitRating).toHaveBeenCalledTimes(1);
    expect(onSubmitRating).toHaveBeenCalledWith("s1", 4);
    expect(submit().disabled).toBe(true);
  });

  it("does not auto-submit again when unmounted right after Submit", () => {
    const { onSubmitRating, onAutoSubmit, unmount } = renderScreen();
    fireEvent.click(disc(2));
    fireEvent.click(submit());
    unmount();
    expect(onSubmitRating).toHaveBeenCalledTimes(1);
    expect(onAutoSubmit).not.toHaveBeenCalled();
  });

  it("auto-submits a selected but unsent rating on unmount", () => {
    const { onAutoSubmit, unmount } = renderScreen();
    fireEvent.click(disc(5));
    unmount();
    expect(onAutoSubmit).toHaveBeenCalledWith("s1", 5);
  });

  it("auto-submits the previous song's pending rating when the song changes", () => {
    const { onAutoSubmit, rerender, onSubmitRating } = renderScreen();
    fireEvent.click(disc(3));
    rerender(
      <RatingScreen
        currentPrompt="prompt"
        songToRate={song("s2")}
        onSubmitRating={onSubmitRating}
        onAutoSubmit={onAutoSubmit}
        currentIndex={1}
        totalSongs={3}
      />,
    );
    expect(onAutoSubmit).toHaveBeenCalledWith("s1", 3);
    expect(submit().disabled).toBe(true); // no rating picked yet for s2
  });
});

describe("RatingScreen with a big screen in the room", () => {
  afterEach(cleanup);

  it("plays the clip with no screen attached and shows no toggle", () => {
    renderScreen();
    expect(screen.getByTestId("clip-player")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Play on this phone" })).toBeNull();
  });

  it("stays silent by default, with a quiet toggle to play here", () => {
    const onTogglePlayOnPhone = vi.fn();
    renderScreen({ screenAttached: true, onTogglePlayOnPhone });
    expect(screen.queryByTestId("clip-player")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Play on this phone" }));
    expect(onTogglePlayOnPhone).toHaveBeenCalledTimes(1);
    // Rating itself is unchanged.
    expect(submit()).toBeTruthy();
  });

  it("plays here once the player turns it on", () => {
    renderScreen({ screenAttached: true, playOnPhone: true, onTogglePlayOnPhone: vi.fn() });
    expect(screen.getByTestId("clip-player")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mute this phone" })).toBeTruthy();
  });
});
