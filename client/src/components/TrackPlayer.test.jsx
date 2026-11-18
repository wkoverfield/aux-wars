import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const seen = {};
const stub = (id) => ({
  default: (props) => {
    seen[id] = props;
    return <div data-testid={id} />;
  },
});
vi.mock("./YouTubePlayer", () => stub("youtube"));
vi.mock("./SoundCloudPlayer", () => stub("soundcloud"));
vi.mock("./AudioPreviewPlayer", () => stub("audio"));

const { default: TrackPlayer } = await import("./TrackPlayer");

const rendered = () => ["youtube", "soundcloud", "audio"].filter((id) => screen.queryByTestId(id));

describe("TrackPlayer", () => {
  afterEach(() => {
    cleanup();
    for (const key of Object.keys(seen)) delete seen[key];
  });

  it("plays a videoId with the YouTube player", () => {
    render(<TrackPlayer videoId="v1" startTime={10} endTime={40} />);
    expect(rendered()).toEqual(["youtube"]);
    expect(seen.youtube).toMatchObject({ videoId: "v1", startTime: 10, endTime: 40 });
  });

  it("plays a soundcloudUrl with the SoundCloud player, with its credit", () => {
    render(
      <TrackPlayer
        soundcloudUrl="https://soundcloud.com/forss/flickermood"
        name="Flickermood"
        artist="Forss"
        artwork="https://i1.sndcdn.com/a.jpg"
        startTime={30}
        endTime={45}
        autoPlay
        loop
        showControls={false}
      />,
    );
    expect(rendered()).toEqual(["soundcloud"]);
    expect(seen.soundcloud).toMatchObject({
      soundcloudUrl: "https://soundcloud.com/forss/flickermood",
      name: "Flickermood",
      artist: "Forss",
      artwork: "https://i1.sndcdn.com/a.jpg",
      startTime: 30,
      endTime: 45,
      autoPlay: true,
      loop: true,
      showControls: false,
    });
  });

  it("plays a preview src with the audio player", () => {
    render(<TrackPlayer src="https://example.com/preview.m4a" />);
    expect(rendered()).toEqual(["audio"]);
    expect(seen.audio).toMatchObject({ src: "https://example.com/preview.m4a" });
  });
});
