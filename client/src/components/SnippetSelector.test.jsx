import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

let playerProps = null;
vi.mock("./TrackPlayer", () => ({
  default: (props) => {
    playerProps = props;
    return <div data-testid="player" />;
  },
}));

const { default: SnippetSelector } = await import("./SnippetSelector");

const soundcloudTrack = {
  id: "sc:forss/flickermood",
  soundcloudUrl: "https://soundcloud.com/forss/flickermood",
  name: "Flickermood",
  artists: [{ name: "Forss" }],
  album: { name: "", images: [{ url: "https://i1.sndcdn.com/a.jpg" }] },
  preview_url: null,
};
const youtubeTrack = { id: "yt:v1", videoId: "v1", name: "Song", artists: [{ name: "A" }], album: { images: [] } };
const previewTrack = { id: "it:1", name: "Song", artists: [{ name: "A" }], album: { images: [] }, preview_url: "https://example.com/p.m4a" };

function renderSelector(track, props = {}) {
  const onConfirm = vi.fn();
  render(<SnippetSelector track={track} onConfirm={onConfirm} onCancel={() => {}} {...props} />);
  return { onConfirm, confirm: () => fireEvent.click(screen.getByRole("button", { name: "Confirm selection" })) };
}

describe("SnippetSelector sources", () => {
  afterEach(() => {
    cleanup();
    playerProps = null;
  });

  it("gives a SoundCloud track the clip window picker and submits the window", () => {
    const { onConfirm, confirm } = renderSelector(soundcloudTrack, { snippetDuration: 15 });
    expect(screen.getByText("Clip your moment")).toBeTruthy();
    expect(playerProps).toMatchObject({
      soundcloudUrl: soundcloudTrack.soundcloudUrl,
      name: "Flickermood",
      artist: "Forss",
      artwork: "https://i1.sndcdn.com/a.jpg",
      startTime: 0,
      endTime: 15,
    });
    expect(playerProps.videoId).toBeUndefined();

    act(() => playerProps.onDuration(240));
    fireEvent.keyDown(screen.getByRole("slider", { name: "Clip window position" }), { key: "ArrowRight", shiftKey: true });
    expect(playerProps).toMatchObject({ startTime: 5, endTime: 20 });
    confirm();
    expect(onConfirm).toHaveBeenCalledWith({ ...soundcloudTrack, snippet: { startTime: 5, endTime: 20 } });
  });

  it("plays a SoundCloud track in full when the room has no clip length", () => {
    const { onConfirm, confirm } = renderSelector(soundcloudTrack, { snippetDuration: 0 });
    expect(screen.getByText("Playing the full song.")).toBeTruthy();
    expect(screen.queryByText("Clip your moment")).toBeNull();
    expect(playerProps).toMatchObject({ soundcloudUrl: soundcloudTrack.soundcloudUrl, startTime: 0, endTime: 0 });
    act(() => playerProps.onDuration(240));
    confirm();
    expect(onConfirm).toHaveBeenCalledWith({ ...soundcloudTrack, snippet: null });
  });

  it("keeps the window picker for a YouTube track", () => {
    const { onConfirm, confirm } = renderSelector(youtubeTrack);
    expect(screen.getByText("Clip your moment")).toBeTruthy();
    expect(playerProps).toMatchObject({ videoId: "v1", startTime: 0, endTime: 30 });
    act(() => playerProps.onDuration(200));
    confirm();
    expect(onConfirm).toHaveBeenCalledWith({ ...youtubeTrack, snippet: { startTime: 0, endTime: 30 } });
  });

  it("previews a 30s clip without a window", () => {
    const { onConfirm, confirm } = renderSelector(previewTrack);
    expect(screen.getByText("Preview your pick")).toBeTruthy();
    expect(playerProps).toMatchObject({ src: previewTrack.preview_url });
    confirm();
    expect(onConfirm).toHaveBeenCalledWith({ ...previewTrack, snippet: null });
  });
});
