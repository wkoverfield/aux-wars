import { useEffect } from "react";
import { HOME_TITLE, pageFor } from "../data/pages";

/**
 * Sets the tab title of a prerendered page (data/pages.js) while it is
 * mounted, so client-side navigation shows the same title the static HTML
 * carries. Restores the home title on unmount: a hard-loaded page's HTML
 * already carries its own title, so "the previous title" would stick.
 */
export function usePageTitle(path) {
  const title = pageFor(path)?.title;
  useEffect(() => {
    if (!title) return undefined;
    document.title = title;
    return () => {
      document.title = HOME_TITLE;
    };
  }, [title]);
}
