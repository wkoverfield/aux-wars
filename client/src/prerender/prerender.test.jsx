// @vitest-environment node
// Node, like the build: the pages must render without browser globals.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { PAGES, SITE } from "../data/pages";
import { buildContentPages } from "../data/contentPages";
import { CONTENT } from "./content.fixture";
import { sitemapXml } from "./sitemap";

vi.mock("convex/react", () => import("./convexStub.js"));

const { render } = await import("./entry.jsx");

const clientDir = fileURLToPath(new URL("../..", import.meta.url));
const vercel = JSON.parse(readFileSync(resolve(clientDir, "../vercel.json"), "utf8"));

const content = buildContentPages(CONTENT);
const contentPage = (path) => content.pages.find((page) => page.path === path);
/** A content page's markup, rendered the way the build does. */
const renderContent = (path) => render(path, { home: content.home, page: contentPage(path).data });

const EXPECTED_TEXT = {
  "/": ["How to Play", "Host game", "the classic"],
  "/faq": ["What is an aux battle?", "How does scoring work?"],
  "/aux-battle": ["What is an aux battle?", "How Aux Wars does it", "Local Play", "Play an aux battle"],
  "/privacy": ["Privacy Policy", "What we collect"],
  "/404": ["Page not found"],
};

describe("prerendered pages", () => {
  it.each(PAGES.map((page) => [page.path]))("%s renders its real text", (path) => {
    const html = render(path);
    for (const text of EXPECTED_TEXT[path]) expect(html).toContain(text);
  });

  it("the homepage links to /aux-battle", () => {
    expect(render("/")).toContain('href="/aux-battle"');
  });

  it("the homepage footer links to /charts", () => {
    expect(render("/")).toMatch(/<a href="\/charts" class="dev-btn[^>]*>.*?Charts<\/p><\/a>/);
  });

  it("vercel.json serves each prerendered page from its own file", () => {
    for (const page of PAGES.filter((p) => p.index && p.path !== "/")) {
      expect(vercel.rewrites).toContainEqual({ source: page.path, destination: `/${page.file}` });
    }
  });

  it("vercel.json has no catch-all rewrite, so unknown paths get 404.html", () => {
    for (const { source } of vercel.rewrites) {
      expect(source).not.toMatch(/^\/\(\(\?!|^\/:path\*$|^\/\(\.\*\)$/);
    }
  });

  it("vercel.json keeps the search API proxy", () => {
    expect(vercel.rewrites[0]).toEqual({
      source: "/api/:path*",
      destination: "https://aux-wars-production.up.railway.app/api/:path*",
    });
  });
});

describe("the homepage chart line", () => {
  const line = (home) => render("/", { home, page: null });

  it("names the top song of the week and links to /charts", () => {
    expect(line(content.home)).toMatch(
      /<a href="\/charts"[^>]*>Most picked this week: SICKO MODE by Travis Scott<\/a>/,
    );
  });

  it("drops 'this week' when the song is the all-time top pick", () => {
    const html = line({ title: "FE!N", artist: "Travis Scott", weekly: false });
    expect(html).toMatch(/<a href="\/charts"[^>]*>Most picked: FE!N by Travis Scott<\/a>/);
  });

  it.each([[undefined], [null], [{ home: null, page: null }], [{ home: { title: "FE!N" }, page: null }]])(
    "renders nothing without the data (%j)",
    (data) => {
      expect(render("/", data)).not.toContain("Most picked");
    },
  );
});

describe("prerendered content pages", () => {
  it("builds /charts, a page per approved week, per song and per artist", () => {
    expect(content.pages.map((page) => page.path).sort()).toEqual([
      "/artist/travis-scott",
      "/charts",
      "/charts/2026-w45",
      "/charts/2026-w46",
      "/song/sheck-wes-mo-bamba",
      "/song/travis-scott-fe-n",
      "/song/travis-scott-sicko-mode",
    ]);
  });

  it("gives every page its own file, title, description and an indexable entry", () => {
    for (const page of content.pages) {
      expect(page.file).toBe(`${page.path.slice(1)}.html`);
      expect(page.index).toBe(true);
      expect(page.title).toBeTruthy();
      expect(page.description).toBeTruthy();
    }
    for (const field of ["file", "title", "description"]) {
      const values = content.pages.filter((page) => !page.path.startsWith("/charts")).map((page) => page[field]);
      expect(new Set(values).size).toBe(values.length);
    }
  });

  it("a song page renders its numbers, prompts and links", () => {
    const html = renderContent("/song/travis-scott-fe-n");
    for (const text of [
      "FE!N",
      "2023",
      "1,117",
      "Times picked",
      "3.42",
      "Average rating out of 5",
      "27%",
      "Round win rate",
      "#1",
      "3,355 ratings",
      "955",
      "A song that starts the mosh pit",
      "53 picks",
      "1 pick<",
      "More by Travis Scott",
      "Start a game",
    ]) {
      expect(html, text).toContain(text);
    }
    expect(html).toContain('<a href="/artist/travis-scott"');
    expect(html).toContain('<a href="/song/travis-scott-sicko-mode"');
    // The largest rating count fills its bar; the others scale against it.
    expect(html).toContain('style="width:100%"');
    expect(html).toContain('style="width:41.9%"');
  });

  it("a song whose artist has no page names the artist as plain text", () => {
    const html = renderContent("/song/sheck-wes-mo-bamba");
    expect(html).toContain("Sheck Wes");
    expect(html).not.toContain("/artist/sheck-wes");
    expect(html).not.toContain("More by");
    expect(html).not.toContain("Picked most for");
  });

  it("an artist page ranks its songs by picks and links the ones with a page", () => {
    const html = renderContent("/artist/travis-scott");
    for (const text of ["Travis Scott", "1,318", "Total picks", "3.43", "Picked most for", "61 picks"]) {
      expect(html, text).toContain(text);
    }
    expect(html.indexOf("FE!N")).toBeLessThan(html.indexOf("SICKO MODE"));
    expect(html.indexOf("SICKO MODE")).toBeLessThan(html.indexOf("goosebumps"));
    expect(html).toContain('<a href="/song/travis-scott-fe-n"');
    expect(html).not.toContain("/song/travis-scott-goosebumps");
  });

  it("/charts renders the latest week without an unapproved note", () => {
    const html = renderContent("/charts");
    for (const text of [
      "Aux Wars Charts",
      "November 16 to 22, 2026",
      "Most picked this week",
      "+23",
      "Most picked songs",
      "Most picked artists",
      "Highest rated songs",
      "3.61",
      "Most divisive songs",
      "1.40",
      "Earlier weeks",
      "Week of November 9, 2026",
      "Week of November 2, 2026",
      "real games played on Aux Wars",
    ]) {
      expect(html, text).toContain(text);
    }
    expect(html).not.toContain("ran the week");
    expect(html).toContain('<a href="/charts/2026-w46"');
    expect(html).toContain('<a href="/song/travis-scott-fe-n"');
    expect(html).toContain('<a href="/artist/travis-scott"');
    // Drake and Sheck Wes have no artist page: named, not linked.
    expect(html).toContain("Drake");
    expect(html).not.toContain("/artist/drake");
    expect(html).not.toContain("/artist/sheck-wes");
  });

  it("a dated chart page renders its approved note as paragraphs", () => {
    const html = renderContent("/charts/2026-w46");
    expect(html).toContain("November 9 to 15, 2026");
    expect(html).toContain("Week of November 9, 2026");
    expect(html).toContain("<p>FE!N ran the week.</p>");
    expect(html).toContain("<p>Mo Bamba split the room: nobody agrees on it.</p>");
    expect(html).not.toContain("Most picked this week");
    expect(html).toContain("Other weeks");
    expect(html).toContain('<a href="/charts/2026-w45"');
    expect(html).not.toContain('href="/charts/2026-w47"');
  });

  it("content pages link with plain anchors and carry a Charts link", () => {
    for (const page of content.pages) {
      const html = renderContent(page.path);
      expect(html, page.path).toContain('<a href="/charts"');
      expect(html, page.path).toContain('<a href="/"');
    }
  });

  it("a content path without its model is not rendered", () => {
    expect(() => render("/song/travis-scott-fe-n")).toThrow(/no element/);
    expect(() => render("/song/other", { home: null, page: contentPage("/charts").data })).toThrow(/no element/);
  });

  it("vercel.json serves each content page from its generated file", () => {
    for (const [source, destination] of [
      ["/charts", "/charts.html"],
      ["/charts/:week", "/charts/:week.html"],
      ["/song/:slug", "/song/:slug.html"],
      ["/artist/:slug", "/artist/:slug.html"],
    ]) {
      expect(vercel.rewrites).toContainEqual({ source, destination });
    }
    // The rewrites reproduce the file each page is written to.
    const patterns = vercel.rewrites
      .filter(({ source }) => /^\/(charts|song|artist)/.test(source))
      .map(({ source, destination }) => ({
        match: new RegExp(`^${source.replace(/:\w+/, "([^/]+)")}$`),
        file: (segment) => destination.replace(/:\w+/, segment).slice(1),
      }));
    for (const page of content.pages) {
      const hit = patterns.find(({ match }) => match.test(page.path));
      expect(hit, page.path).toBeTruthy();
      expect(hit.file(page.path.match(hit.match)[1] ?? ""), page.path).toBe(page.file);
    }
  });
});

describe("sitemap.xml", () => {
  const xml = sitemapXml([...PAGES, ...content.pages], SITE);
  const locs = [...xml.matchAll(/<loc>https:\/\/www\.aux-wars\.com([^<]*)<\/loc>/g)].map((m) => m[1]);

  it("lists exactly the indexable pages, static and content", () => {
    const indexable = [...PAGES, ...content.pages].filter((page) => page.index).map((page) => page.path);
    expect([...locs].sort()).toEqual(indexable.sort());
    expect(locs).not.toContain("/404");
  });

  it("contains the song, artist and chart pages", () => {
    for (const path of ["/song/travis-scott-fe-n", "/artist/travis-scott", "/charts", "/charts/2026-w46"]) {
      expect(locs).toContain(path);
    }
  });

  it("is generated by the build, with no hand-written copy in public/", () => {
    expect(existsSync(resolve(clientDir, "public/sitemap.xml"))).toBe(false);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
  });
});
