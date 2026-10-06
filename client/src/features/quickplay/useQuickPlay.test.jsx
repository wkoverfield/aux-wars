import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { msUntilNextSecond, SecondsLeft, TICK_SLACK_MS } from "./useQuickPlay";

describe("msUntilNextSecond", () => {
  it("waits until just after the deadline's next second boundary", () => {
    expect(msUntilNextSecond(10_000, 15_250)).toBe(250 + TICK_SLACK_MS);
    expect(msUntilNextSecond(10_249, 15_250)).toBe(1 + TICK_SLACK_MS);
    expect(msUntilNextSecond(10_250, 15_250)).toBe(1000 + TICK_SLACK_MS);
  });

  it("aligns to the wall clock without a deadline", () => {
    expect(msUntilNextSecond(10_400)).toBe(600 + TICK_SLACK_MS);
  });
});

describe("SecondsLeft", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("ticks once per second on the deadline's boundaries", () => {
    const renders = [];
    function Probe({ target }) {
      renders.push(Date.now());
      return <SecondsLeft target={target} />;
    }
    // Deadline 3.4s away: shows 4, then 3 at +0.4s, 2 at +1.4s, ...
    const { container } = render(<Probe target={103_400} />);
    expect(container.textContent).toBe("4");

    act(() => { vi.advanceTimersByTime(399); });
    expect(container.textContent).toBe("4");
    act(() => { vi.advanceTimersByTime(TICK_SLACK_MS + 1); });
    expect(container.textContent).toBe("3");
    act(() => { vi.advanceTimersByTime(1000); });
    expect(container.textContent).toBe("2");
    act(() => { vi.advanceTimersByTime(2000); });
    expect(container.textContent).toBe("0");
    // The parent never re-rendered: the tick lives in the leaf.
    expect(renders).toHaveLength(1);
  });

  it("renders nothing without a target", () => {
    const { container } = render(<SecondsLeft target={null} />);
    expect(container.textContent).toBe("");
  });
});
