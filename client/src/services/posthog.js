/**
 * Client-side PostHog (product analytics).
 *
 * Gives us the things the server-side `posthog-node` setup can't: pageviews,
 * the game funnel, sampled session replays, and web analytics. Usage counts
 * live in Convex, not here. No-ops when no key is
 * configured (local dev without VITE_POSTHOG_KEY) so nothing breaks or spams.
 *
 * Consent: the cookie banner is dark until AdSense is configured, so there's
 * no active consent prompt today and the app's existing analytics (Convex
 * pageviews, Vercel) already run ungated. We match that — capture by default —
 * but honor an explicit `rejected` choice if/when the banner goes live.
 */
import posthog from "posthog-js";
import { CONSENT_EVENT, CONSENT_KEY, getConsent } from "./ads";
import { getVisitorId } from "../utils/visitorId";

const KEY = import.meta.env.VITE_POSTHOG_KEY || "";
const HOST = import.meta.env.VITE_POSTHOG_HOST || "https://us.i.posthog.com";
let started = false;

function sanitizeUrl(value) {
  if (!value || typeof value !== "string") return value;
  return value.replace(/\/lobby\/[^/?#]+/g, "/lobby/[room]");
}

function isStatsPage(path) {
  return typeof path === "string" && (path === "/stats" || path.startsWith("/stats/"));
}

export function sanitizeEvent(event) {
  if (!event?.properties) return event;
  const props = event.properties;
  // The private /stats dashboard is not product usage; send nothing from it.
  if (isStatsPage(props.$pathname)) return null;
  props.$current_url = sanitizeUrl(props.$current_url);
  props.$pathname = sanitizeUrl(props.$pathname);
  props.$referrer = sanitizeUrl(props.$referrer);
  props.$initial_current_url = sanitizeUrl(props.$initial_current_url);
  props.$initial_pathname = sanitizeUrl(props.$initial_pathname);
  props.$initial_referrer = sanitizeUrl(props.$initial_referrer);
  return event;
}

export function syncPostHogConsent(client, consent) {
  const optedOut = client.has_opted_out_capturing();

  if (consent === "rejected") {
    if (!optedOut) client.opt_out_capturing();
    return;
  }

  // Capture is already on by default. Only transition back from an explicit
  // rejection, and suppress PostHog's otherwise-billable `$opt_in` event.
  if (optedOut) client.opt_in_capturing({ captureEventName: false });
}

function applyConsent() {
  if (!started) return;
  syncPostHogConsent(posthog, getConsent());
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
    // Autocapture OFF: it fired $autocapture/$rageclick/$dead_click on every
    // click/drag/change across a click-heavy realtime game (~1.4k events per
    // session), which blew past PostHog's 1M-event free tier. Our explicit
    // funnel events (POSTHOG_EVENTS) are the signal we actually want; this
    // was pure noise. Re-enable only with a config'd allowlist if ever needed.
    autocapture: false,
    before_send: sanitizeEvent,
    disable_session_recording: false,
    session_recording: {
      // Show gameplay in replays — searches, player names, prompts, and game
      // codes aren't sensitive, and they're what we want to see. The only
      // credential is the Pro code, masked via the `ph-no-capture` class on
      // that one input. data-ph-mask stays as a hook for future sensitive text.
      maskAllInputs: false,
      maskTextSelector: "[data-ph-mask]",
      // Sample at 20%: full recording isn't needed and a viral spike would
      // otherwise blow the 5k-recording/mo replay free tier the same way
      // autocapture blew the event tier.
      sampleRate: 0.2,
    },
  });

  applyConsent();
  window.addEventListener(CONSENT_EVENT, applyConsent);
  window.addEventListener("storage", (event) => {
    // PostHog and the game both write heavily to localStorage. Reacting to all
    // of those writes caused cross-tab `$opt_in` feedback loops.
    if (event.key === CONSENT_KEY) applyConsent();
  });
}

/**
 * The only custom events sent to PostHog: the game funnel. Every other count
 * (ratings, submissions, searches, settings, prompt packs) is recorded by
 * Convex, so PostHog is billed for funnel steps and sampled replays only.
 * An event missing from this list is dropped by `capture`.
 */
export const POSTHOG_EVENTS = Object.freeze([
  "session_start",
  "host_game_clicked",
  "game_created",
  "player_joined",
  "game_started",
  "round_completed",
  "game_completed_viewed",
  "play_again_clicked",
  "song_search_no_results",
  "lobby_left",
]);

const ALLOWED_EVENTS = new Set(POSTHOG_EVENTS);

export function isAllowedEvent(event) {
  return ALLOWED_EVENTS.has(event);
}

/**
 * Fire-and-forget event capture; no-ops until initialized, drops events not in
 * POSTHOG_EVENTS, never throws.
 */
export function capture(event, properties) {
  if (!started || !isAllowedEvent(event)) return;
  try {
    posthog.capture(event, properties);
  } catch {
    /* analytics must never break the game */
  }
}

export { posthog };
