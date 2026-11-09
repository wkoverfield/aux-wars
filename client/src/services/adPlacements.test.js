import { describe, expect, it } from "vitest";
import { AD_PLACEMENTS } from "./ads";

// Every source file under src, as text.
const sources = import.meta.glob(["../**/*.{js,jsx}", "!../**/*.test.{js,jsx}"], {
  query: "?raw",
  import: "default",
  eager: true,
});

const fileName = (path) => path.replace(/^\.\.\//, "");

// YouTube API Developer Policies III.G.1.d: no ads on a screen that shows
// YouTube API data. These are the only screens without it (see services/ads.js).
const AD_SCREENS = {
  "features/lobby/Home.jsx": ["home"],
  "features/lobby/Lobby.jsx": ["lobby"],
  "features/quickplay/PublicLobby.jsx": ["lobby"],
  "features/round/WaitingScreen.jsx": ["wait"],
  "features/legal/Faq.jsx": ["faq"],
  "features/legal/AuxBattle.jsx": ["auxBattle"],
};

function adSlotsIn(source) {
  return [...source.matchAll(/<AdSlot\b[^>]*\bslot="([^"]+)"/g)].map((m) => m[1]);
}

describe("ad placements", () => {
  it("only the ad-safe screens render an AdSlot", () => {
    const found = {};
    for (const [path, source] of Object.entries(sources)) {
      const slots = adSlotsIn(source);
      if (slots.length) found[fileName(path)] = slots;
    }
    expect(found).toEqual(AD_SCREENS);
  });

  it("results, game over, rating, song selection and the shared screen have no AdSlot", () => {
    const youtubeScreens = Object.keys(sources).filter((path) =>
      /features\/(round-winner|screen)\/|features\/round\/(RatingScreen|SongSelection|Round)\.jsx$/.test(path),
    );
    expect(youtubeScreens.length).toBeGreaterThan(0);
    for (const path of youtubeScreens) {
      expect(sources[path], fileName(path)).not.toMatch(/AdSlot/);
    }
  });

  it("every placement used has a slot id variable", () => {
    const used = new Set(Object.values(AD_SCREENS).flat());
    expect([...used].sort()).toEqual([...AD_PLACEMENTS].sort());
  });
});
