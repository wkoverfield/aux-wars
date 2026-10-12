import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../components/ScrollFade", () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock("../../components/SongList", () => ({
  default: ({ emptyText }) => <div data-testid="empty">{emptyText === undefined ? "default" : String(emptyText)}</div>,
}));

const { SongSelectionView: SongSelection } = await import("./SongSelection");

const base = { searchTerm: "song", onSearchChange: () => {}, searchResults: [], searchError: null, onSelectSong: () => {}, onShowPrompt: () => {} };

describe("SongSelection search status", () => {
  afterEach(cleanup);

  it("shows a young search as a spinner inside the search bar, with no row above the results", () => {
    render(<SongSelection {...base} isSearching isSearchSlow={false} onRetrySearch={() => {}} />);
    const status = screen.getByText("Searching for songs...").closest('[role="status"]');
    expect(status.closest(".search-bar")).toBeTruthy();
    expect(screen.getByRole("textbox").getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByText("Still searching...")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("only lets the list say it is empty when a search finished empty with no error", () => {
    const empty = () => screen.getByTestId("empty").textContent;
    const { rerender } = render(<SongSelection {...base} searchTerm="" />);
    expect(empty()).toBe("Search for a song to play.");
    rerender(<SongSelection {...base} isSearching />);
    expect(empty()).toBe("null");
    rerender(<SongSelection {...base} searchError="No songs found. Try different keywords." />);
    expect(empty()).toBe("null");
    rerender(<SongSelection {...base} />);
    expect(empty()).toBe("default");
  });

  it("shows no spinner when idle", () => {
    render(<SongSelection {...base} isSearching={false} />);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows Still searching with a Retry button when slow", () => {
    const onRetrySearch = vi.fn();
    render(<SongSelection {...base} isSearching isSearchSlow onRetrySearch={onRetrySearch} />);
    expect(screen.getByText("Still searching...")).toBeTruthy();
    expect(screen.queryByText("Searching for songs...")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetrySearch).toHaveBeenCalledTimes(1);
  });
});
