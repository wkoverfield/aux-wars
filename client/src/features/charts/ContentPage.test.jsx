import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { buildContentPages } from "../../data/contentPages";
import { PAGE_DATA_ID, PageDataContext, pageDataScript, readPageData, serializePageData } from "../../data/pageData";
import { CONTENT } from "../../prerender/content.fixture";
import ContentPage from "./ContentPage";

const content = buildContentPages(CONTENT);

const tree = (data, path) => (
  <PageDataContext.Provider value={data}>
    <MemoryRouter initialEntries={[path]}>
      <ContentPage />
    </MemoryRouter>
  </PageDataContext.Provider>
);

/** Markup as the browser holds it, so server and client output compare equal. */
function asDom(html) {
  const holder = document.createElement("div");
  // React marks adjacent text nodes with empty comments in server output.
  holder.innerHTML = html.replace(/<!-- -->/g, "");
  // Server output writes style="width:50%"; the DOM serializes "width: 50%;".
  for (const styled of holder.querySelectorAll("[style]")) {
    styled.setAttribute("style", styled.style.cssText);
  }
  return holder.innerHTML;
}

afterEach(() => {
  cleanup();
  document.getElementById(PAGE_DATA_ID)?.remove();
});

describe("content page build data", () => {
  it.each(content.pages.map((page) => [page.path, page]))(
    "%s mounts from the document's data to the prerendered markup",
    (path, page) => {
      const data = { home: content.home, page: page.data };
      const prerendered = renderToString(tree(data, path));

      // The document as the build writes it: markup, then the data script.
      document.body.insertAdjacentHTML("beforeend", pageDataScript(data));
      const read = readPageData();
      expect(read).toEqual(data);

      const { container } = render(tree(read, path));
      expect(container.innerHTML).toBe(asDom(prerendered));
      expect(container.textContent.length).toBeGreaterThan(100);
    },
  );

  it("is null when the document carries no data or unreadable data", () => {
    expect(readPageData()).toBeNull();
    document.body.insertAdjacentHTML("beforeend", `<script type="application/json" id="${PAGE_DATA_ID}">{oops</script>`);
    expect(readPageData()).toBeNull();
  });

  it("cannot close its script tag from inside a string", () => {
    const data = { home: { title: "</script><script>alert(1)</script>", artist: "<b>", weekly: true }, page: null };
    expect(serializePageData(data)).not.toContain("<");
    document.body.insertAdjacentHTML("beforeend", pageDataScript(data));
    expect(readPageData()).toEqual(data);
    expect(document.querySelectorAll("script").length).toBe(1);
  });
});

describe("ContentPage", () => {
  const song = content.pages.find((page) => page.path === "/song/travis-scott-fe-n");

  it("renders the model that belongs to the current path", () => {
    render(tree({ home: null, page: song.data }, "/song/travis-scott-fe-n/"));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("FE!N");
  });

  it("shows the 404 page when the document has no model", () => {
    render(tree(null, "/song/travis-scott-fe-n"));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Page not found");
  });

  it("shows the 404 page when the model belongs to another path", () => {
    render(tree({ home: null, page: song.data }, "/song/travis-scott-sicko-mode"));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Page not found");
  });

  it("shows text and numbers only: no images, players or outside links", () => {
    for (const page of content.pages) {
      const { container, unmount } = render(tree({ home: null, page: page.data }, page.path));
      expect(container.querySelectorAll("img, iframe, audio, video, picture, svg").length, page.path).toBe(0);
      for (const link of container.querySelectorAll("a")) {
        expect(link.getAttribute("href"), page.path).toMatch(/^\/[a-z0-9/-]*$/);
        expect(link.getAttribute("target"), page.path).toBeNull();
      }
      unmount();
    }
  });

  it("puts a start-a-game link on the song page only, styled like the page's other links", () => {
    for (const page of content.pages) {
      const { container, unmount } = render(tree({ home: null, page: page.data }, page.path));
      const cta = [...container.querySelectorAll("a")].filter((link) => link.textContent.startsWith("Start a game"));
      expect(cta.length, page.path).toBe(page.data.kind === "song" ? 1 : 0);
      if (cta.length) {
        expect(cta[0].textContent).toBe("Start a game on Aux Wars");
        expect(cta[0].getAttribute("href")).toBe("/");
        // The same classes as the artist link under the title, when the
        // artist has a page: no filled button.
        const artistLink = container.querySelector('a[href^="/artist/"]');
        if (artistLink) expect(cta[0].className.trim()).toBe(artistLink.className.trim());
        expect(cta[0].className).toContain("underline");
        expect(cta[0].className).not.toMatch(/bg-|rounded|font-bold/);
      }
      expect(container.querySelector('[class*="bg-[#68d570]"]'), page.path).toBeNull();
      unmount();
    }
  });

  it("has no em dash in any page's text", () => {
    for (const page of content.pages) {
      const { container, unmount } = render(tree({ home: null, page: page.data }, page.path));
      expect(container.textContent, page.path).not.toContain("\u2014");
      unmount();
    }
  });

  it("wraps long words and keeps its bottom padding: one content-sized column holds the whole page", () => {
    for (const page of content.pages) {
      const { container, unmount } = render(tree({ home: null, page: page.data }, page.path));
      const column = container.querySelector("h1").parentElement;
      // overflow-wrap is inherited, so every title, name and row inside wraps.
      for (const cls of ["wrap-anywhere", "min-w-0", "self-start", "pb-16"]) {
        expect(column.classList.contains(cls), `${page.path} ${cls}`).toBe(true);
      }
      for (const node of container.querySelectorAll("h1, h2, li, footer")) {
        expect(column.contains(node), page.path).toBe(true);
      }
      unmount();
    }
  });

  it("draws a rating bar for every count above zero, never thinner than a dot, and none for zero", () => {
    const [first, ...others] = CONTENT.songs;
    // 5 stars: 1000, 4: 0, 3: 1 (0.1 percent of the largest), 2: 20, 1: 0.
    const hist = [0, 20, 1, 0, 1000];
    const built = buildContentPages({ ...CONTENT, songs: [{ ...first, ratingHist: hist }, ...others] });
    const page = built.pages.find((p) => p.path === song.path);
    const { container } = render(tree({ home: null, page: page.data }, page.path));

    const rows = [...container.querySelectorAll("ol > li")].filter((li) => li.querySelector(".sr-only"));
    expect(rows.map((li) => li.querySelector(".sr-only").nextSibling.textContent)).toEqual(["5", "4", "3", "2", "1"]);
    const fills = rows.map((li) => li.querySelector("span.rounded-full > span"));
    expect(fills.map((fill) => fill?.style.width ?? null)).toEqual(["100%", null, "0.1%", "2%", null]);
    for (const fill of fills.filter(Boolean)) {
      // min-w-2.5 equals the track height (h-2.5): a full dot at the least.
      expect(fill.classList.contains("min-w-2.5")).toBe(true);
      expect(fill.parentElement.classList.contains("h-2.5")).toBe(true);
    }
    // The track itself is always drawn.
    expect(rows.every((li) => li.querySelector("span.rounded-full"))).toBe(true);
  });
});
