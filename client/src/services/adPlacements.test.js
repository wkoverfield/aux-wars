import { describe, expect, it } from "vitest";
import { AD_PLACEMENTS } from "./ads";

// Every source file under src, as text.
const sources = import.meta.glob(["../**/*.{js,jsx}", "!../**/*.test.{js,jsx}"], {
  query: "?raw",
  import: "default",
  eager: true,
});

const fileName = (path) => path.replace(/^\.\.\//, "");

// The only screens allowed an ad (see services/ads.js): pages with publisher
// content (AdSense program policies) that show no YouTube API data (YouTube
// API Developer Policies III.G.1.d) and no SoundCloud content.
const AD_SCREENS = {
  "features/lobby/Home.jsx": ["home"],
  "features/legal/Faq.jsx": ["faq"],
  "features/legal/AuxBattle.jsx": ["auxBattle"],
  "features/charts/ChartsPage.jsx": ["charts"],
  "features/charts/SongPage.jsx": ["song"],
  "features/charts/ArtistPage.jsx": ["artist"],
};

// Every <AdSlot> use, by its literal slot name. A computed slot or spread
// props can't be checked, so it is reported as "<non-literal>" and fails.
function adSlotsIn(source) {
  return [...source.matchAll(/<AdSlot\b([^>]*)/g)].map((m) => {
    const literal = m[1].match(/\bslot="([^"]+)"/);
    return literal && !/\{\s*\.\.\./.test(m[1]) ? literal[1] : "<non-literal>";
  });
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

  it("the lobby and the waiting screen have no AdSlot", () => {
    const gameScreens = Object.keys(sources).filter((path) =>
      /features\/lobby\/Lobby\.jsx$|features\/quickplay\/|features\/round\/WaitingScreen\.jsx$/.test(path),
    );
    expect(gameScreens.length).toBeGreaterThan(2);
    for (const path of gameScreens) {
      expect(sources[path], fileName(path)).not.toMatch(/AdSlot/);
    }
  });

  it("the content pages link to no player and embed no media but the one stored image", () => {
    const contentPages = Object.keys(sources).filter((path) => /features\/charts\//.test(path));
    expect(contentPages.length).toBeGreaterThan(0);
    for (const path of contentPages) {
      expect(sources[path], fileName(path)).not.toMatch(/<iframe\b|<audio\b|<video\b|youtube|youtu\.be|soundcloud|albumCover/i);
    }
    // The only <img> is PageHeader's: a cover from the Cover Art Archive or a
    // Wikimedia Commons photo, served from Convex file storage. Song and
    // artist pages render it; chart pages do not.
    const withImg = contentPages.filter((path) => /<img\b/.test(sources[path])).map(fileName);
    expect(withImg).toEqual(["features/charts/ContentShell.jsx"]);
    expect(sources[contentPages.find((path) => path.endsWith("ContentShell.jsx"))].match(/<img\b/g)).toHaveLength(1);
    expect(sources[contentPages.find((path) => path.endsWith("ChartsPage.jsx"))]).not.toMatch(/PageHeader/);
  });

  it("only the ad-safe screens import AdSlot, so no wrapper can carry it elsewhere", () => {
    const importers = Object.entries(sources)
      .filter(([, source]) => /import\s+AdSlot\b|components\/AdSlot/.test(source))
      .map(([path]) => fileName(path))
      .filter((path) => path !== "components/AdSlot.jsx")
      .sort();
    expect(importers).toEqual(Object.keys(AD_SCREENS).sort());
  });

  it("every placement used has a slot id variable", () => {
    const used = new Set(Object.values(AD_SCREENS).flat());
    expect([...used].sort()).toEqual([...AD_PLACEMENTS].sort());
  });
});
