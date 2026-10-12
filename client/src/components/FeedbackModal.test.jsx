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
