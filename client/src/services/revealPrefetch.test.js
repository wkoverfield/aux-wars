import { describe, expect, it } from "vitest";
import { revealPrefetch } from "./revealPrefetch";

const room = (phase, currentRound, numberOfRounds = 3) => ({ phase, currentRound, settings: { numberOfRounds } });

describe("revealPrefetch", () => {
  it("holds nothing before the rating phase", () => {
    for (const phase of ["lobby", "promptVoting", "songSelection"]) {
      expect(revealPrefetch(room(phase, 1))).toEqual({ round: null, finalRound: false });
    }
    expect(revealPrefetch(null)).toEqual({ round: null, finalRound: false });
  });

  it("prefetches the round results from rating through results", () => {
    expect(revealPrefetch(room("rating", 1))).toEqual({ round: 1, finalRound: false });
    expect(revealPrefetch(room("results", 2))).toEqual({ round: 2, finalRound: false });
  });

  it("adds the whole-game results on the final round", () => {
    expect(revealPrefetch(room("rating", 3))).toEqual({ round: 3, finalRound: true });
    expect(revealPrefetch(room("gameOver", 3))).toEqual({ round: null, finalRound: true });
  });

  it("uses the same default round count as the results screen", () => {
    expect(revealPrefetch({ phase: "rating", currentRound: 3, settings: {} }).finalRound).toBe(true);
  });
});
