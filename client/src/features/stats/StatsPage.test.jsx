import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { STATS_KEY_STORAGE } from "./statsModel";

const convexQuery = vi.fn();
const useQuery = vi.fn();
const client = { query: (...args) => convexQuery(...args) };

vi.mock("convex/react", () => ({
  useConvex: () => client,
  useQuery: (...args) => useQuery(...args),
}));

const { default: StatsPage, CHECK_TIMEOUT_MS } = await import("./StatsPage");

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/stats"]}>
      <StatsPage />
    </MemoryRouter>,
  );
}

function submitKey(value) {
  fireEvent.change(screen.getByLabelText("Admin key"), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Unlock" }));
}

describe("StatsPage key gate", () => {
  beforeEach(() => {
    localStorage.clear();
    convexQuery.mockReset();
    useQuery.mockReset();
    useQuery.mockReturnValue(undefined);
  });

  afterEach(() => {
    cleanup();
    document.head.querySelectorAll('meta[name="robots"]').forEach((m) => m.remove());
  });

  it("sets noindex while mounted and removes it after", () => {
    const { unmount } = renderPage();
    expect(document.head.querySelector('meta[name="robots"]').getAttribute("content")).toBe("noindex, nofollow");
    unmount();
    expect(document.head.querySelector('meta[name="robots"]')).toBeNull();
  });

  it("prompts for a key and subscribes to nothing without one", () => {
    renderPage();
    expect(screen.getByLabelText("Admin key")).toBeTruthy();
    expect(convexQuery).not.toHaveBeenCalled();
    expect(useQuery).not.toHaveBeenCalled();
  });

  it("rejects a bad key without subscribing to the throwing queries", async () => {
    convexQuery.mockResolvedValue({ ok: false });
    renderPage();
    submitKey("wrong");

    await screen.findByText("That key was not accepted.");
    expect(convexQuery).toHaveBeenCalledWith(expect.anything(), { adminKey: "wrong" });
    expect(useQuery).not.toHaveBeenCalled();
    expect(localStorage.getItem(STATS_KEY_STORAGE)).toBeNull();
  });

  it("stores an accepted key and only then subscribes", async () => {
    convexQuery.mockResolvedValue({ ok: true });
    renderPage();
    submitKey("  right  ");

    await screen.findByText("Aux Wars stats");
    expect(localStorage.getItem(STATS_KEY_STORAGE)).toBe("right");
    const args = useQuery.mock.calls.map((call) => call[1]);
    expect(args).toContainEqual({ adminKey: "right" });
    expect(args).toContainEqual({ adminKey: "right", days: 7 });
  });

  it("drops a saved key that is no longer accepted", async () => {
    localStorage.setItem(STATS_KEY_STORAGE, "stale");
    convexQuery.mockResolvedValue({ ok: false });
    renderPage();

    await screen.findByText("The saved key stopped working. Paste the current one.");
    expect(localStorage.getItem(STATS_KEY_STORAGE)).toBeNull();
    expect(useQuery).not.toHaveBeenCalled();
  });

  it("shows a service error without clearing the prompt", async () => {
    convexQuery.mockRejectedValue(new Error("offline"));
    renderPage();
    submitKey("right");

    await screen.findByText("Could not reach the stats service. Try again.");
    expect(useQuery).not.toHaveBeenCalled();
  });

  it("renders empty rollups without crashing", async () => {
    localStorage.setItem(STATS_KEY_STORAGE, "right");
    convexQuery.mockResolvedValue({ ok: true });
    useQuery.mockImplementation((_fn, args) => ("days" in args ? { days: [], hourly: [], funnel: null } : { now: null, allTimePeak: null, today: null }));
    renderPage();

    await screen.findByText("No peak recorded yet. The first sample lands within a minute of someone playing.");
    expect(await screen.findByText("Nothing recorded today yet.")).toBeTruthy();
    expect(await screen.findByText("No hourly samples yet.")).toBeTruthy();
    expect(await screen.findByText("No Quick Play clicks in this window yet.")).toBeTruthy();
    expect(document.body.textContent).not.toContain("—");
  });

  it("returns to the prompt when a stats query throws after the key was revoked", async () => {
    localStorage.setItem(STATS_KEY_STORAGE, "right");
    convexQuery.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false });
    useQuery.mockImplementation(() => {
      throw new Error("Invalid admin key");
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderPage();

    await screen.findByText("The saved key stopped working. Paste the current one.");
    await waitFor(() => expect(localStorage.getItem(STATS_KEY_STORAGE)).toBeNull());
    spy.mockRestore();
  });

  it("offers a retry when a query throws but the key is still valid", async () => {
    localStorage.setItem(STATS_KEY_STORAGE, "right");
    convexQuery.mockResolvedValue({ ok: true });
    let fail = true;
    useQuery.mockImplementation(() => {
      if (fail) throw new Error("boom");
      return undefined;
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderPage();

    await screen.findByText("The dashboard could not load. The key is still valid.");
    expect(localStorage.getItem(STATS_KEY_STORAGE)).toBe("right");
    fail = false;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    });
    expect(screen.getByText("Trends")).toBeTruthy();
    spy.mockRestore();
  });

  it("says a saved key is being checked", async () => {
    localStorage.setItem(STATS_KEY_STORAGE, "right");
    convexQuery.mockReturnValue(new Promise(() => {}));
    renderPage();

    expect(screen.getByText("Checking saved key…")).toBeTruthy();
  });

  it("shows the service error when the key check never answers", async () => {
    vi.useFakeTimers();
    try {
      convexQuery.mockReturnValue(new Promise(() => {}));
      renderPage();
      submitKey("right");
      expect(screen.getByRole("button", { name: "Checking…" })).toBeTruthy();

      await act(async () => {
        await vi.advanceTimersByTimeAsync(CHECK_TIMEOUT_MS + 1);
      });
      expect(screen.getByText("Could not reach the stats service. Try again.")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Unlock" })).toBeTruthy();
      expect(useQuery).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("Speed card", () => {
  afterEach(() => cleanup());

  it("shows p75 vitals by device class and error counts", async () => {
    localStorage.clear();
    convexQuery.mockReset();
    convexQuery.mockResolvedValue({ ok: true });
    useQuery.mockReset();
    useQuery.mockImplementation((_fn, args) =>
      args && "days" in args
        ? {
            days: [],
            speed: {
              vitals: [
                { metric: "LCP", deviceClass: "all", p75: 2400, samples: 12 },
                { metric: "LCP", deviceClass: "chromebook", p75: 4600, samples: 3 },
                { metric: "INP", deviceClass: "all", p75: 180, samples: 9 },
              ],
              errors: { client: 5, boundary: 1 },
              slowInteractions: [
                {
                  route: "/lobby/:code/round", target: "rating>record:img", samples: 12, slow: 7, p75: 340,
                  inputDelay: 20, processing: 260, presentation: 60, mobileShare: 0.9, script: "app",
                },
              ],
              errorKinds: [{ kind: "error", name: "ChunkLoadError", route: "/lobby/:code", count: 4 }],
            },
          }
        : {},
    );
    renderPage();
    submitKey("right");

    await screen.findByText("Speed (real devices)");
    expect(screen.getByText("2.4s").className).toContain("text-[#68d570]");
    expect(screen.getByText("4.6s").className).toContain("text-red-400");
    expect(screen.getByText("180ms")).toBeTruthy();
    expect(screen.getByText("Uncaught errors").nextSibling.textContent).toBe("5");
    expect(screen.getByText("Error screens shown").nextSibling.textContent).toBe("1");
    expect(screen.getByText("rating > record (img)")).toBeTruthy();
    expect(screen.getByText("340ms").className).toContain("text-amber-300");
    expect(screen.getByText("7/12")).toBeTruthy();
    expect(screen.getByText("Our tap handler (260ms)")).toBeTruthy();
    expect(screen.getByRole("list", { name: "Errors by type" }).textContent).toContain("ChunkLoadError on /lobby/:code4");
  });
});
