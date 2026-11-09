// @vitest-environment node
// Node, like the build: the pages must render without browser globals.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { PAGES } from "../data/pages";

vi.mock("convex/react", () => import("./convexStub.js"));

const { render } = await import("./entry.jsx");

const clientDir = fileURLToPath(new URL("../..", import.meta.url));
const sitemap = readFileSync(resolve(clientDir, "public/sitemap.xml"), "utf8");
const vercel = JSON.parse(readFileSync(resolve(clientDir, "../vercel.json"), "utf8"));

const EXPECTED_TEXT = {
  "/": ["How to Play", "Host game", "the classic"],
  "/faq": ["What is an aux battle?", "How does scoring work?"],
  "/aux-battle": ["What is an aux battle?", "How Aux Wars plays it", "Local Play", "Play an aux battle"],
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

  it("the sitemap lists exactly the indexable pages", () => {
    const locs = [...sitemap.matchAll(/<loc>https:\/\/www\.aux-wars\.com([^<]*)<\/loc>/g)].map((m) => m[1]);
    const indexable = PAGES.filter((page) => page.index).map((page) => page.path);
    expect(locs.sort()).toEqual(indexable.sort());
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
