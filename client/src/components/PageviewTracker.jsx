import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { getVisitorId } from "../utils/visitorId";
import { notifyRouteChange } from "../services/posthog";

/**
 * Fires a Convex `recordPageview` on each route change (and lets the deferred
 * PostHog loader know about it). Fire-and-forget.
 * A ref guards against StrictMode double-renders inflating counts.
 * Renders nothing.
 */
export default function PageviewTracker() {
  const location = useLocation();
  const recordPageview = useMutation(api.siteStats.recordPageview);
  const lastPath = useRef(null);

  useEffect(() => {
    const path = location.pathname;
    if (lastPath.current === path) return;
    lastPath.current = path;
    notifyRouteChange();
    try {
      const p = recordPageview({ path, visitorId: getVisitorId() });
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch {
      /* never break the app over analytics */
    }
  }, [location.pathname, recordPageview]);

  return null;
}
