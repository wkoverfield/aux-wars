// @vitest-environment node
import { describe, expect, it } from "vitest";
import { ARTISTS, CHARTS, CONTENT, SONGS } from "../prerender/content.fixture";
import { formatDate, formatDateRange } from "./contentFormat";
import { buildContentPages } from "./contentPages";

const page = (content, path) => buildContentPages(content).pages.find((entry) => entry.path === path);

describe("buildContentPages", () => {
  it("lowercases the week id for the chart URL and file", () => {
    const dated = page(CONTENT, "/charts/2026-w46");
    expect(dated.file).toBe("charts/2026-w46.html");
    expect(dated.data.week).toBe("2026-W46");
  });

  it("uses the week flagged latest for /charts, or the newest week without a flag", () => {
    expect(page(CONTENT, "/charts").data.week).toBe("2026-W47");
    const unflagged = CHARTS.map((week) => ({ ...week, isLatest: false }));
    expect(page({ ...CONTENT, charts: unflagged }, "/charts").data.week).toBe("2026-W47");
  });

  it("gives the latest week a dated page too once its note is approved", () => {
    const approved = CHARTS.map((week) =>
      week.isLatest ? { ...week, note: "Approved.", approvedAt: 1795392000000 } : week,
    );
    const { pages } = buildContentPages({ ...CONTENT, charts: approved });
    const dated = pages.find((entry) => entry.path === "/charts/2026-w47");
    expect(dated.data.note).toEqual(["Approved."]);
    // /charts lists only the weeks before it; a dated page lists every other week.
    expect(pages.find((entry) => entry.path === "/charts").data.weeks.map((week) => week.href)).toEqual([
      "/charts/2026-w46",
      "/charts/2026-w45",
    ]);
    expect(dated.data.weeks.map((week) => week.href)).toEqual(["/charts/2026-w46", "/charts/2026-w45"]);
  });

  it("leaves out a list with no rows, such as movers before a second week", () => {
    expect(page(CONTENT, "/charts/2026-w46").data.lists.map((list) => list.key)).toEqual([
      "mostPickedSongs",
      "mostPickedArtists",
      "highestRated",
      "mostDivisive",
    ]);
    expect(page(CONTENT, "/charts").data.lists[0].key).toBe("movers");
  });

  it("takes the home line from the week's movers, or the all-time top song without them", () => {
    expect(buildContentPages(CONTENT).home).toEqual({ title: "SICKO MODE", artist: "Travis Scott", weekly: true });
    const noMovers = CHARTS.map((week) => ({ ...week, lists: { ...week.lists, movers: null } }));
    expect(buildContentPages({ ...CONTENT, charts: noMovers }).home).toEqual({
      title: "FE!N",
      artist: "Travis Scott",
      weekly: false,
    });
    const empty = CHARTS.map((week) => ({ ...week, lists: { ...week.lists, movers: [], mostPickedSongs: [] } }));
    expect(buildContentPages({ ...CONTENT, charts: empty }).home).toBeNull();
  });

  it("computes the round win rate and omits it for a song never picked", () => {
    expect(page(CONTENT, "/song/travis-scott-fe-n").data.winRate).toBe(27);
    const unpicked = [{ ...SONGS[0], picks: 0, wins: 0 }, ...SONGS.slice(1)];
    expect(page({ ...CONTENT, songs: unpicked }, "/song/travis-scott-fe-n").data.winRate).toBeNull();
  });

  it("lists the artist's other songs on a song page, most picked first", () => {
    expect(page(CONTENT, "/song/travis-scott-sicko-mode").data.moreByArtist).toEqual([
      { title: "FE!N", href: "/song/travis-scott-fe-n", picks: 1117, average: 3.416 },
    ]);
    expect(page(CONTENT, "/song/sheck-wes-mo-bamba").data.moreByArtist).toEqual([]);
  });

  it.each([["../etc"], ["Has-Caps"], ["a b"], ["a/b"], [""], [undefined], ["-a"], ["a--b"]])(
    "rejects the song slug %j, since slugs become file names",
    (slug) => {
      expect(() => buildContentPages({ ...CONTENT, songs: [{ ...SONGS[0], slug }] })).toThrow(/invalid slug/);
    },
  );

  it("rejects an invalid artist slug or week id", () => {
    expect(() => buildContentPages({ ...CONTENT, artists: [{ ...ARTISTS[0], slug: "a/../b" }] })).toThrow(/invalid slug/);
    expect(() => buildContentPages({ ...CONTENT, charts: [{ ...CHARTS[0], week: "../2026-W46" }] })).toThrow(
      /invalid chart week/,
    );
  });

  it("rejects duplicates, which would write one file twice", () => {
    expect(() => buildContentPages({ ...CONTENT, songs: [SONGS[0], SONGS[0]] })).toThrow(/duplicate song slug/);
    expect(() => buildContentPages({ ...CONTENT, charts: [CHARTS[0], CHARTS[0]] })).toThrow(/duplicate chart week/);
  });

  it("fails without a chart week, since /charts could not be written", () => {
    expect(() => buildContentPages({ ...CONTENT, charts: [] })).toThrow(/no chart week/);
  });
});

describe("content dates", () => {
  it("formats a date and a week range without a timezone", () => {
    expect(formatDate("2026-11-09")).toBe("November 9, 2026");
    expect(formatDateRange("2026-11-16", "2026-11-22")).toBe("November 16 to 22, 2026");
    expect(formatDateRange("2026-11-30", "2026-12-06")).toBe("November 30 to December 6, 2026");
    expect(formatDateRange("2026-12-28", "2027-01-03")).toBe("December 28, 2026 to January 3, 2027");
  });

  it("rejects anything that is not YYYY-MM-DD", () => {
    expect(() => formatDate("11/09/2026")).toThrow(/bad date/);
    expect(() => formatDate("2026-13-01")).toThrow(/bad date/);
  });
});
