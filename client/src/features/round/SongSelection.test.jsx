import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../components/ScrollFade", () => ({ default: ({ children }) => <div>{children}</div> }));
vi.mock("../../components/SongList", () => ({ default: () => null }));

const { SongSelectionView: SongSelection } = await import("./SongSelection");

const base = { searchTerm: "song", onSearchChange: () => {}, searchResults: [], searchError: null, onSelectSong: () => {}, onShowPrompt: () => {} };

describe("SongSelection search status", () => {
  afterEach(cleanup);

  it("shows the plain spinner text while a search is young", () => {
    render(<SongSelection {...base} isSearching isSearchSlow={false} onRetrySearch={() => {}} />);
    expect(screen.getByText("Searching for songs...")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });

  it("shows Still searching with a Retry button when slow", () => {
    const onRetrySearch = vi.fn();
    render(<SongSelection {...base} isSearching isSearchSlow onRetrySearch={onRetrySearch} />);
    expect(screen.getByText("Still searching...")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetrySearch).toHaveBeenCalledTimes(1);
  });
});
