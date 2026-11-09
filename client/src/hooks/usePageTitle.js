import { useEffect } from "react";
import { pageFor } from "../data/pages";

/**
 * Sets the tab title of a prerendered page (data/pages.js) while it is
 * mounted, so client-side navigation shows the same title the static HTML
 * carries. Restores the previous title on unmount.
 */
export function usePageTitle(path) {
  const title = pageFor(path)?.title;
  useEffect(() => {
    if (!title) return undefined;
    const previous = document.title;
    document.title = title;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
