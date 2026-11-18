import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import SoundCloudPlayer from "./SoundCloudPlayer";

const TRACK_URL = "https://soundcloud.com/forss/flickermood";
const API_SRC = "https://w.soundcloud.com/player/api.js";
const ERROR_COPY = "This SoundCloud track cannot be played here.";
const EVENTS = {
  READY: "ready",
  PLAY: "play",
  PAUSE: "pause",
  FINISH: "finish",
  SEEK: "seek",
  PLAY_PROGRESS: "playProgress",
  ERROR: "error",
};

/**
 * A stand-in for SC.Widget: records the calls made to it in order and lets a
 * test send widget events. `seekStartsPlayback` reproduces the real widget's
 * habit of starting playback by itself on a seek made while paused.
 */
function installWidget({ durationMs = 240_000, seekStartsPlayback = false } = {}) {
  const handlers = {};
  const widget = {
    calls: [],
    position: 0,
    paused: true,
    iframe: null,
    emit: (event, payload) => act(() => handlers[event]?.(payload)),
    bind: (event, fn) => { handlers[event] = fn; },
    unbind: (event) => { delete handlers[event]; },
    getDuration: (cb) => cb(durationMs),
    seekTo: (ms) => {
      widget.calls.push(["seekTo", ms]);
      widget.position = ms;
      if (seekStartsPlayback && widget.paused) {
        widget.paused = false;
        handlers[EVENTS.PLAY]?.({ currentPosition: ms });
      }
    },
    play: () => {
      widget.calls.push(["play"]);
      widget.paused = false;
      handlers[EVENTS.PLAY]?.({ currentPosition: widget.position });
    },
    pause: () => {
      widget.calls.push(["pause"]);
      widget.paused = true;
      handlers[EVENTS.PAUSE]?.({ currentPosition: widget.position });
    },
  };
  const Widget = vi.fn((iframe) => {
    widget.iframe = iframe;
    return widget;
  });
  Widget.Events = EVENTS;
  window.SC = { Widget };
  return widget;
}

async function mount(props = {}) {
  const ref = createRef();
  const callbacks = {
    onReady: vi.fn(),
    onTimeUpdate: vi.fn(),
    onEnded: vi.fn(),
    onDuration: vi.fn(),
    onPlayingChange: vi.fn(),
  };
  const utils = render(
    <SoundCloudPlayer
      ref={ref}
      soundcloudUrl={TRACK_URL}
      name="Flickermood"
      artist="Forss"
      artwork="https://i1.sndcdn.com/artworks-000067273316-smsiqx-t500x500.jpg"
      startTime={30}
      endTime={45}
      {...callbacks}
      {...props}
    />,
  );
  await act(async () => {}); // the API promise resolves, the widget is created
  return { ref, ...callbacks, ...utils };
}

const tapToPlay = () => screen.queryByRole("button", { name: "Play" });
const callNames = (widget) => widget.calls.map(([name]) => name);

describe("SoundCloudPlayer", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    delete window.SC;
    document.querySelectorAll(`script[src="${API_SRC}"]`).forEach((tag) => tag.remove());
  });

  it("loads the widget API once for any number of players", async () => {
    render(
      <>
        <SoundCloudPlayer soundcloudUrl={TRACK_URL} />
        <SoundCloudPlayer soundcloudUrl="https://soundcloud.com/forss/journeyman" />
      </>,
    );
    await act(async () => {});
    expect(document.querySelectorAll(`script[src="${API_SRC}"]`)).toHaveLength(1);
  });

  it("keeps the widget iframe in the DOM, 1px and invisible", async () => {
    const widget = installWidget();
    await mount();
    const { iframe } = widget;
    expect(iframe.isConnected).toBe(true);
    expect(iframe.getAttribute("src")).toBe(
      `https://w.soundcloud.com/player/?url=${encodeURIComponent(TRACK_URL)}&auto_play=false&single_active=false`,
    );
    expect(iframe.getAttribute("allow")).toBe("autoplay; encrypted-media");
    expect(iframe.style.width).toBe("1px");
    expect(iframe.style.height).toBe("1px");
    expect(iframe.style.opacity).toBe("0");
    expect(iframe.style.pointerEvents).toBe("none");
    expect(iframe.style.display).not.toBe("none");
  });

  it("reports the full track length and the window length when ready", async () => {
    const widget = installWidget({ durationMs: 240_000 });
    const { onDuration, onReady } = await mount();
    widget.emit(EVENTS.READY);
    expect(onDuration).toHaveBeenCalledWith(240);
    expect(onReady).toHaveBeenCalledWith(15);
  });

  it("uses the rest of the track as the window when there is no end", async () => {
    const widget = installWidget({ durationMs: 240_000 });
    const { onReady } = await mount({ startTime: 0, endTime: 0 });
    widget.emit(EVENTS.READY);
    expect(onReady).toHaveBeenCalledWith(240);
    expect(widget.calls).toEqual([]); // nothing to seek to, nothing played
  });

  it("seeks to the window start before play, from the tap itself", async () => {
    const widget = installWidget();
    const { onPlayingChange } = await mount();
    expect(tapToPlay().disabled).toBe(true); // not ready yet
    widget.emit(EVENTS.READY);
    expect(widget.calls).toEqual([["seekTo", 30_000]]);
    expect(widget.paused).toBe(true);

    fireEvent.click(tapToPlay());
    expect(callNames(widget)).toEqual(["seekTo", "play"]);
    expect(widget.position).toBe(30_000);
    expect(onPlayingChange).toHaveBeenLastCalledWith(true);
    expect(tapToPlay()).toBeNull(); // overlay goes once playback has started
  });

  it("ends paused at the window start when the initial seek starts playback by itself", async () => {
    const widget = installWidget({ seekStartsPlayback: true });
    const { onPlayingChange } = await mount({ autoPlay: false });
    widget.emit(EVENTS.READY);
    expect(widget.calls).toEqual([["seekTo", 30_000], ["pause"]]);
    expect(widget.paused).toBe(true);
    expect(widget.position).toBe(30_000);
    expect(onPlayingChange).not.toHaveBeenCalledWith(true);
    expect(tapToPlay()).toBeTruthy(); // still waiting for the first real play

    // The first real play re-seeks to the window start, then plays.
    fireEvent.click(tapToPlay());
    expect(widget.calls.slice(-2)).toEqual([["seekTo", 30_000], ["play"]]);
    expect(widget.paused).toBe(false);
    expect(onPlayingChange).toHaveBeenLastCalledWith(true);
  });

  it("autoplays from the window start", async () => {
    const widget = installWidget();
    const { onPlayingChange } = await mount({ autoPlay: true });
    widget.emit(EVENTS.READY);
    expect(widget.calls).toEqual([["seekTo", 30_000], ["play"]]);
    expect(onPlayingChange).toHaveBeenLastCalledWith(true);
  });

  it("re-seeks when playback starts before the window", async () => {
    const widget = installWidget();
    await mount({ autoPlay: true });
    widget.emit(EVENTS.READY);
    widget.calls.length = 0;
    widget.emit(EVENTS.PLAY, { currentPosition: 0 }); // the seek before play was dropped
    expect(widget.calls).toEqual([["seekTo", 30_000]]);
  });

  it("reports window-relative time", async () => {
    const widget = installWidget();
    const { onTimeUpdate, ref } = await mount({ autoPlay: true });
    widget.emit(EVENTS.READY);
    widget.emit(EVENTS.PLAY_PROGRESS, { currentPosition: 37_000 });
    expect(onTimeUpdate).toHaveBeenLastCalledWith(7);
    expect(ref.current.getCurrentTime()).toBe(7);
    expect(ref.current.getDuration()).toBe(15);
  });

  it("stops at the window end and fires onEnded once", async () => {
    const widget = installWidget();
    const { onEnded, onPlayingChange, ref } = await mount({ autoPlay: true });
    widget.emit(EVENTS.READY);
    widget.emit(EVENTS.PLAY_PROGRESS, { currentPosition: 45_010 });
    widget.emit(EVENTS.PLAY_PROGRESS, { currentPosition: 45_060 }); // still in flight after the pause
    expect(widget.paused).toBe(true);
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(onPlayingChange).toHaveBeenLastCalledWith(false);

    // Playing again starts the window over.
    act(() => ref.current.play());
    expect(widget.calls.slice(-2)).toEqual([["seekTo", 30_000], ["play"]]);
  });

  it("loops back to the window start instead of ending", async () => {
    const widget = installWidget();
    const { onEnded, onTimeUpdate } = await mount({ autoPlay: true, loop: true });
    widget.emit(EVENTS.READY);
    widget.calls.length = 0;
    widget.emit(EVENTS.PLAY_PROGRESS, { currentPosition: 45_010 });
    widget.emit(EVENTS.PLAY_PROGRESS, { currentPosition: 45_060 });
    expect(widget.calls).toEqual([["seekTo", 30_000]]); // one seek, no pause
    expect(widget.paused).toBe(false);
    expect(onEnded).not.toHaveBeenCalled();
    expect(onTimeUpdate).toHaveBeenLastCalledWith(0);
  });

  it("ends or loops when the track itself runs out", async () => {
    const once = installWidget();
    const first = await mount({ autoPlay: true, startTime: 0, endTime: 0 });
    once.emit(EVENTS.READY);
    once.emit(EVENTS.FINISH);
    expect(first.onEnded).toHaveBeenCalledTimes(1);
    cleanup();

    const looping = installWidget();
    const second = await mount({ autoPlay: true, loop: true, startTime: 0, endTime: 0 });
    looping.emit(EVENTS.READY);
    looping.calls.length = 0;
    looping.emit(EVENTS.FINISH);
    expect(looping.calls).toEqual([["seekTo", 0], ["play"]]);
    expect(second.onEnded).not.toHaveBeenCalled();
  });

  it("seeks, toggles and reports playing through the ref", async () => {
    const widget = installWidget();
    const { ref, onTimeUpdate } = await mount({ autoPlay: true });
    widget.emit(EVENTS.READY);
    expect(ref.current.isPlaying()).toBe(true);

    act(() => ref.current.seekTo(5));
    expect(widget.calls.at(-1)).toEqual(["seekTo", 35_000]);
    expect(onTimeUpdate).toHaveBeenLastCalledWith(5);

    act(() => ref.current.toggle());
    expect(widget.paused).toBe(true);
    expect(ref.current.isPlaying()).toBe(false);
    act(() => ref.current.toggle());
    expect(widget.paused).toBe(false);
    expect(widget.calls.at(-1)).toEqual(["play"]); // resumes where it paused: no seek
  });

  it("moves a playing preview to a new window", async () => {
    const widget = installWidget();
    const { rerender } = await mount({ autoPlay: true, loop: true });
    widget.emit(EVENTS.READY);
    rerender(<SoundCloudPlayer soundcloudUrl={TRACK_URL} startTime={60} endTime={75} autoPlay loop />);
    expect(widget.calls.at(-1)).toEqual(["seekTo", 60_000]);
    expect(widget.paused).toBe(false);
  });

  it("offers only the playable preview of a preview-only track to the clip picker", async () => {
    const widget = installWidget({ durationMs: 177_032 });
    widget.getCurrentSound = (cb) => cb({ duration: 30_000, full_duration: 177_032, policy: "SNIP" });
    const { onDuration } = await mount({ startTime: 0, endTime: 0 });
    widget.emit(EVENTS.READY);
    expect(onDuration).toHaveBeenCalledWith(30);
  });

  it("keeps the full length when the sound's own length matches it", async () => {
    const widget = installWidget({ durationMs: 213_890 });
    widget.getCurrentSound = (cb) => cb({ duration: 213_890, policy: "MONETIZE" });
    const { onDuration } = await mount({ startTime: 0, endTime: 0 });
    widget.emit(EVENTS.READY);
    expect(onDuration).toHaveBeenCalledWith(213.89);
  });

  it("says to pick another result only where a result can be picked", async () => {
    const widget = installWidget();
    await mount({ canPickAnother: true });
    widget.emit(EVENTS.ERROR);
    expect(screen.getByText("This SoundCloud track cannot be played here. Pick another result.")).toBeTruthy();
  });

  it("shows the error copy when the widget reports an error", async () => {
    const widget = installWidget();
    await mount();
    widget.emit(EVENTS.ERROR);
    expect(screen.getByText(ERROR_COPY)).toBeTruthy();
    expect(tapToPlay()).toBeNull();
  });

  it("shows the error copy when the widget never becomes ready", async () => {
    vi.useFakeTimers();
    installWidget();
    await mount();
    expect(screen.queryByText(ERROR_COPY)).toBeNull();
    act(() => { vi.advanceTimersByTime(8000); });
    expect(screen.getByText(ERROR_COPY)).toBeTruthy();
  });

  it("does not time out once the widget is ready", async () => {
    vi.useFakeTimers();
    const widget = installWidget();
    await mount();
    widget.emit(EVENTS.READY);
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(screen.queryByText(ERROR_COPY)).toBeNull();
  });

  it("shows the official logo, linking to the track and naming the uploader", async () => {
    installWidget();
    await mount();
    const logo = screen.getByRole("link", { name: "Listen to Flickermood by Forss on SoundCloud" });
    expect(logo.getAttribute("href")).toBe(TRACK_URL);
    expect(logo.getAttribute("target")).toBe("_blank");
    expect(logo.getAttribute("rel")).toBe("noopener noreferrer");
    expect(logo.querySelector('img[alt="SoundCloud"]')).toBeTruthy();
    expect(logo.className).toContain("bg-[#121212]");
    // The title and uploader are the surrounding screen's to show, once.
    expect(screen.queryByText("Flickermood")).toBeNull();
  });

  it("hides the tap overlay when the caller draws its own controls", async () => {
    const widget = installWidget();
    await mount({ showControls: false });
    widget.emit(EVENTS.READY);
    expect(tapToPlay()).toBeNull();
  });
});
