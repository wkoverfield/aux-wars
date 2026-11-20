import { createContext, useContext } from "react";

/**
 * Build data carried inside each prerendered document.
 *
 * The prerender plugin (vite.config.js) writes one JSON script tag per HTML
 * file: `{ home, page }`. `home` is the homepage chart line, present in every
 * document so the line survives client-side navigation to "/". `page` is the
 * model of a content page (charts, song, artist) and is null everywhere else.
 * The build renders components from this object, and the app reads the same
 * object back on mount, so both produce the same markup.
 */
export const PAGE_DATA_ID = "aux-wars-page-data";

/** JSON that is safe inside a script tag: no "<" can close the element. */
export function serializePageData(data) {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

/** The script tag the build places after #root. */
export function pageDataScript(data) {
  return `<script type="application/json" id="${PAGE_DATA_ID}">${serializePageData(data)}</script>`;
}

/** The current document's build data, or null when it carries none. */
export function readPageData() {
  if (typeof document === "undefined") return null;
  const text = document.getElementById(PAGE_DATA_ID)?.textContent;
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const PageDataContext = createContext(null);

/** `{ home, page }` for the current document, or null. */
export function usePageData() {
  return useContext(PageDataContext);
}
