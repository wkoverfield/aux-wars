import { useEffect } from "react";
import { HOME_TITLE } from "../data/pages";

/**
 * Keeps the current page out of search indexes while it is mounted, and sets
 * its tab title. The host should also send X-Robots-Tag for the route, since
 * this tag only exists once the app has rendered.
 */
export function useNoIndex(title) {
  useEffect(() => {
    let meta = document.head.querySelector('meta[name="robots"]');
    const created = !meta;
    const previous = meta?.getAttribute("content") ?? null;
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "robots");
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", "noindex, nofollow");
    if (title) document.title = title;
    return () => {
      if (title) document.title = HOME_TITLE;
      if (created) meta.remove();
      else if (previous !== null) meta.setAttribute("content", previous);
    };
  }, [title]);
}
