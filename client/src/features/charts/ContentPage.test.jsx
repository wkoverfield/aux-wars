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

  it("puts a start-a-game link on the song page only", () => {
    for (const page of content.pages) {
      const { container, unmount } = render(tree({ home: null, page: page.data }, page.path));
      const cta = [...container.querySelectorAll("a")].filter((link) => link.textContent === "Start a game");
      expect(cta.length, page.path).toBe(page.data.kind === "song" ? 1 : 0);
      unmount();
    }
  });
});
