import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { buildContentPages } from "../../data/contentPages";
import { PAGE_DATA_ID, PageDataContext, pageDataScript, readPageData, serializePageData } from "../../data/pageData";
import { CONTENT, COVER, PHOTO } from "../../prerender/content.fixture";
import ContentPage from "./ContentPage";

const content = buildContentPages(CONTENT);

const tree = (data, path) => (
  <PageDataContext.Provider value={data}>
    <MemoryRouter initialEntries={[path]}>
      <ContentPage />
    </MemoryRouter>
  </PageDataContext.Provider>
);

/** Markup with every <img>'s attributes in one order: server and client write them in different ones. */
function normalized(root) {
  for (const img of root.querySelectorAll("img")) {
    const attributes = [...img.attributes].map(({ name, value }) => [name, value]).sort(([a], [b]) => (a < b ? -1 : 1));
    for (const [name] of attributes) img.removeAttribute(name);
    for (const [name, value] of attributes) img.setAttribute(name, value);
  }
  return root.innerHTML;
}

/** Markup as the browser holds it, so server and client output compare equal. */
function asDom(html) {
  const holder = document.createElement("div");
  // React marks adjacent text nodes with empty comments in server output.
  holder.innerHTML = html.replace(/<!-- -->/g, "");
  // Server output writes style="width:50%"; the DOM serializes "width: 50%;".
  for (const styled of holder.querySelectorAll("[style]")) {
    styled.setAttribute("style", styled.style.cssText);
  }
  // Server output starts with a preload hint for an image that loads eagerly.
  for (const hint of holder.querySelectorAll('link[rel="preload"][as="image"]')) hint.remove();
  return normalized(holder);
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
      expect(normalized(container.cloneNode(true))).toBe(asDom(prerendered));
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

  it("shows text and numbers, at most one stored image, and no players or outside links but a photo credit", () => {
    for (const page of content.pages) {
      const { container, unmount } = render(tree({ home: null, page: page.data }, page.path));
      expect(container.querySelectorAll("iframe, audio, video, picture, svg").length, page.path).toBe(0);
      expect(container.querySelectorAll("img").length, page.path).toBe(page.data.image ? 1 : 0);
      if (page.data.kind === "charts") expect(container.querySelector("img"), page.path).toBeNull();
      for (const link of container.querySelectorAll("a")) {
        const credit = link.textContent.startsWith("Photo: ");
        expect(link.getAttribute("href"), page.path).toMatch(credit ? /^https:\/\/commons\.wikimedia\.org\// : /^\/[a-z0-9/-]*$/);
        expect(link.getAttribute("target"), page.path).toBeNull();
      }
      unmount();
    }
  });

  describe("images", () => {
    const pageOf = (overrides, path) => buildContentPages({ ...CONTENT, ...overrides }).pages.find((p) => p.path === path);
    const show = (page) => render(tree({ home: null, page: page.data }, page.path)).container;
    const artistWith = (image) => pageOf({ artists: [{ ...CONTENT.artists[0], image }] }, "/artist/travis-scott");

    it("a song page shows its cover beside the title", () => {
      const container = show(song);
      const img = container.querySelector("img");
      expect(Object.fromEntries([...img.attributes].map(({ name, value }) => [name, value]))).toEqual({
        src: COVER.url,
        width: "250",
        height: "250",
        alt: "Cover of FE!N by Travis Scott",
        loading: "eager",
        decoding: "async",
        class: "h-24 w-24 sm:h-40 sm:w-40 shrink-0 rounded-xl object-cover object-top bg-white/10",
      });
      const header = img.parentElement;
      expect(header.className).toBe("mt-6 flex items-center gap-4 sm:gap-6");
      expect(header.querySelector("h1").textContent).toBe("FE!N");
      expect(header.querySelector("h1").className).toBe("text-3xl font-bold");
      expect(header.querySelector('a[href="/artist/travis-scott"]')).not.toBeNull();
      // A cover carries no credit line.
      expect(container.querySelector("footer").textContent).not.toContain("Photo:");
    });

    it("without an image the header is the heading alone, whether the field is null or absent", () => {
      for (const path of ["/song/travis-scott-sicko-mode", "/song/sheck-wes-mo-bamba"]) {
        const page = content.pages.find((p) => p.path === path);
        expect(page.data.image, path).toBeNull();
        const container = show(page);
        expect(container.querySelector("img"), path).toBeNull();
        const h1 = container.querySelector("h1");
        expect(h1.className, path).toBe("text-3xl font-bold mt-6");
        expect(h1.previousElementSibling.getAttribute("aria-label"), path).toBe("Breadcrumb");
        expect(h1.nextElementSibling.className, path).toBe("mt-2 text-gray-300");
        cleanup();
      }
      const artist = artistWith(null);
      const container = show(artist);
      const h1 = container.querySelector("h1");
      expect(h1.className).toBe("text-3xl font-bold mt-6");
      expect(h1.previousElementSibling.getAttribute("aria-label")).toBe("Breadcrumb");
      expect(h1.nextElementSibling.tagName).toBe("DL");
      expect(container.querySelector("footer").children.length).toBe(2);
    });

    it("an artist photo is credited in one footer line that links to its Commons page", () => {
      const artist = content.pages.find((p) => p.path === "/artist/travis-scott");
      const container = show(artist);
      const img = container.querySelector("img");
      expect(img.getAttribute("src")).toBe(PHOTO.url);
      expect(img.getAttribute("alt")).toBe("Photo of Travis Scott");
      expect([img.getAttribute("width"), img.getAttribute("height")]).toEqual(["320", "213"]);
      expect(img.parentElement.querySelector("h1").textContent).toBe("Travis Scott");

      const footer = container.querySelector("footer");
      const [numbers, credit, links] = footer.children;
      expect(numbers.tagName).toBe("P");
      expect(links.tagName).toBe("NAV");
      expect(credit.textContent).toBe("Photo: Jane Doe, CC BY-SA 4.0, via Wikimedia Commons");
      const link = credit.querySelector("a");
      expect(link.textContent).toBe(credit.textContent);
      expect(link.getAttribute("href")).toBe(PHOTO.credit.pageUrl);
      expect(link.getAttribute("rel")).toBe("noopener");
      expect(link.getAttribute("target")).toBeNull();
      expect(credit.className).not.toMatch(/bg-|font-bold/);
    });

    it("an artist page that falls back to a cover names the song and has no credit line", () => {
      const container = show(artistWith({ ...COVER, credit: null }));
      expect(container.querySelector("img").getAttribute("alt")).toBe("Cover of FE!N by Travis Scott");
      expect(container.querySelector("footer").textContent).not.toContain("Photo:");
      expect(container.querySelector("footer").children.length).toBe(2);
    });

    it("an image that is not an https URL with a pixel size is left out and the page still builds", () => {
      for (const image of [
        { ...COVER, url: "http://example.com/a.jpg" },
        { ...COVER, url: "javascript:alert(1)" },
        { ...COVER, url: undefined },
        { ...COVER, width: 0 },
        { ...COVER, height: "250" },
        "https://example.com/a.jpg",
        {},
      ]) {
        const page = pageOf({ songs: [{ ...CONTENT.songs[0], image }, ...CONTENT.songs.slice(1)] }, song.path);
        expect(page.data.image, JSON.stringify(image)).toBeNull();
        expect(artistWith(image).data, JSON.stringify(image)).toMatchObject({ image: null, credit: null });
      }
      // A credit that is incomplete or does not link over https is dropped; the image stays.
      for (const credit of [{ ...PHOTO.credit, author: " " }, { ...PHOTO.credit, pageUrl: "javascript:alert(1)" }, "Jane"]) {
        expect(artistWith({ ...PHOTO, credit }).data, JSON.stringify(credit)).toMatchObject({ image: { url: PHOTO.url }, credit: null });
      }
    });
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
      const column = container.querySelector('nav[aria-label="Breadcrumb"]').parentElement;
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
