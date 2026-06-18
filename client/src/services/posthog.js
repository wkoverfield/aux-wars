/**
 * Client-side PostHog (product analytics).
 *
 * Gives us the things the server-side `posthog-node` setup can't: pageviews,
 * autocapture, the real game funnel, and web analytics. No-ops when no key is
 * configured (local dev without VITE_POSTHOG_KEY) so nothing breaks or spams.
 *
 * Consent: the cookie banner is dark until AdSense is configured, so there's
 * no active consent prompt today and the app's existing analytics (Convex
 * pageviews, Vercel) already run ungated. We match that — capture by default —
 * but honor an explicit `rejected` choice if/when the banner goes live.
 */
import posthog from "posthog-js";
import { getConsent } from "./ads";
import { getVisitorId } from "../utils/visitorId";

const KEY = import.meta.env.VITE_POSTHOG_KEY || "";
const HOST = import.meta.env.VITE_POSTHOG_HOST || "https://us.i.posthog.com";
const CONSENT_EVENT = "aux-wars-consent-changed"; // mirrors ads.js

let started = false;

function applyConsent() {
  if (!started) return;
  // 'rejected' opts out; 'accepted'/null capture (matches existing analytics).
  if (getConsent() === "rejected") posthog.opt_out_capturing();
  else posthog.opt_in_capturing();
}

/** Initialize once. Safe to call when no key is set (it just no-ops). */
export function initPostHog() {
  if (started || !KEY || typeof window === "undefined") return;
  started = true;

  posthog.init(KEY, {
    api_host: HOST,
    // Share the persistent visitor id so client events line up with the
    // server-side `music_searched` events (which use the same id).
    bootstrap: { distinctID: getVisitorId() },
    person_profiles: "identified_only", // no anonymous-person bloat
    capture_pageview: "history_change", // SPA pageviews on route change
    autocapture: true,
    disable_session_recording: true, // not opted into recording for now
  });

  applyConsent();
  window.addEventListener(CONSENT_EVENT, applyConsent);
  window.addEventListener("storage", applyConsent);
}

/** Fire-and-forget event capture; no-ops until initialized, never throws. */
export function capture(event, properties) {
  if (!started) return;
  try {
    posthog.capture(event, properties);
  } catch {
    /* analytics must never break the game */
  }
}

export { posthog };
