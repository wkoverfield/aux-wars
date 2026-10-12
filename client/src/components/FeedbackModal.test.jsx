import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("convex/react", () => ({
  useQuery: () => [],
  useMutation: () => vi.fn(async () => ({ success: true })),
}));

const { default: FeedbackModal } = await import("./FeedbackModal");

/** Makes every storage call throw, as a browser with storage blocked does. */
function blockStorage() {
  const denied = () => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  };
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(denied);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(denied);
}

describe("getVoterId", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is the stored visitor id when storage works", async () => {
    const { getVisitorId, getVoterId } = await import("../utils/visitorId");
    expect(getVoterId()).toBe(getVisitorId());
    expect(getVoterId()).not.toBe("anon");
  });

  it("is a stable per-load id, never the shared anon, when storage is blocked", async () => {
    blockStorage();
    const { getVisitorId, getVoterId } = await import("../utils/visitorId");
    expect(getVisitorId()).toBe("anon");
    const id = getVoterId();
    expect(id).not.toBe("anon");
    expect(id.length).toBeGreaterThan(8);
    expect(getVoterId()).toBe(id);
  });
});

describe("FeedbackModal with storage blocked", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders closed without throwing (it is mounted on the home page)", () => {
    blockStorage();
    expect(() => render(<FeedbackModal showModal={false} onClose={() => {}} />)).not.toThrow();
  });

  it("opens without throwing", () => {
    blockStorage();
    render(<FeedbackModal showModal onClose={() => {}} />);
    expect(screen.getAllByRole("button").length).toBeGreaterThan(0);
  });
});
