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
 *
 * Loading: posthog-js is fetched with a dynamic import so it stays out of the
 * main bundle. The import starts on the first of: an idle callback (3s
 * timeout), the first client-side route change, or the first capture().
 * Captures made before then are buffered with their original timestamps.
 */
import { CONSENT_EVENT, CONSENT_KEY, getConsent } from "./ads";
import { getVisitorId } from "../utils/visitorId";

const KEY = import.meta.env.VITE_POSTHOG_KEY || "";
const HOST = import.meta.env.VITE_POSTHOG_HOST || "https://us.i.posthog.com";

const IDLE_TIMEOUT_MS = 3000;
// Browsers without requestIdleCallback (Safari) load after this delay.
const IDLE_FALLBACK_MS = 1500;
const MAX_BUFFERED = 50;
// Kept in a variable so the allowlist scan in posthog.test.js does not read
// this internal pageview as a funnel capture call.
const PAGEVIEW_EVENT = "$pageview";
const CLICK_ID_PARAMS = ["gclid", "gbraid", "wbraid", "fbclid", "msclkid", "ttclid", "twclid", "li_fat_id"];

// The landing page as the visitor arrived, before any client-side navigation.
// posthog-js reads campaign params and the entry URL from `location` when it
// initializes, which may be after the router has moved on.
const landing =
  typeof window === "undefined"
    ? null
    : { href: window.location.href, pathname: window.location.pathname, referrer: document.referrer, time: new Date() };

// idle (no key / not started) -> scheduled -> loading -> ready | failed
let state = "idle";
let client = null;
let buffer = [];

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
  if (getConsent() === "rejected") buffer = [];
  if (state === "ready") {
    syncPostHogConsent(client, getConsent());
  } else if (state === "scheduled") {
    // A load skipped while consent was rejected can go ahead now.
    load();
  }
}

/** Campaign params (utm_* and ad click ids) present in a URL. */
export function campaignParamsFrom(href) {
  const params = {};
  let search;
  try {
    search = new URL(href).searchParams;
  } catch {
    return params;
  }
  for (const [key, value] of search) {
    if (!value) continue;
    if (key.startsWith("utm_") || CLICK_ID_PARAMS.includes(key)) params[key] = value;
  }
  return params;
}

/**
 * When the router navigated before posthog-js loaded, posthog would record the
 * current page as the entry and miss the landing URL's campaign params. Put
 * them back: session super properties carry the UTMs and referrer onto every
 * event this session, and a pageview stamped with the load time records the
 * page the visitor actually landed on.
 */
function attributeLanding(ph) {
  if (!landing || window.location.href === landing.href) return;
  const session = campaignParamsFrom(landing.href);
  if (landing.referrer) {
    session.$referrer = landing.referrer;
    try {
      session.$referring_domain = new URL(landing.referrer).host;
    } catch {
      /* unparseable referrer: keep the raw value only */
    }
  }
  if (Object.keys(session).length > 0) ph.register_for_session(session);

  let host;
  try {
    host = new URL(landing.href).host;
  } catch {
    host = window.location.host;
  }
  ph.capture(
    PAGEVIEW_EVENT,
    { $current_url: landing.href, $host: host, $pathname: landing.pathname },
    { timestamp: landing.time }
  );
}

function flushBuffer(ph) {
  const pending = buffer;
  buffer = [];
  if (getConsent() === "rejected") return;
  for (const item of pending) {
    try {
      ph.capture(
        item.event,
        { $current_url: item.href, $pathname: item.pathname, ...item.properties },
        { timestamp: item.timestamp }
      );
    } catch {
      /* analytics must never break the game */
    }
  }
}

function start(ph) {
  ph.init(KEY, {
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
    // No surveys are configured; skip loading the surveys script.
    disable_surveys: true,
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
  client = ph;
  state = "ready";
  syncPostHogConsent(ph, getConsent());
  if (getConsent() === "rejected") {
    buffer = [];
    return;
  }
  // posthog-js captures its own initial pageview on the next tick, so these
  // land before it and keep the landing URL as the session entry.
  try {
    attributeLanding(ph);
  } catch {
    /* analytics must never break the game */
  }
  flushBuffer(ph);
}

function load() {
  if (state !== "scheduled") return;
  // Nothing is sent while consent is rejected, so don't fetch the SDK either.
  if (getConsent() === "rejected") {
    buffer = [];
    return;
  }
  state = "loading";
  import("posthog-js")
    .then((mod) => start(mod.default))
    .catch(() => {
      // Offline, blocked by an extension, or a stale chunk after a deploy.
      // Analytics is optional: drop it for this page load, never reload.
      state = "failed";
      client = null;
      buffer = [];
    });
}

function scheduleIdleLoad() {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(load, { timeout: IDLE_TIMEOUT_MS });
  } else {
    setTimeout(load, IDLE_FALLBACK_MS);
  }
}

/**
 * Start PostHog once. Safe to call when no key is set (it just no-ops). The SDK
 * itself is fetched later (see the loading note at the top of this file).
 */
export function initPostHog() {
  if (state !== "idle" || !KEY || typeof window === "undefined") return;
  state = "scheduled";

  window.addEventListener(CONSENT_EVENT, applyConsent);
  window.addEventListener("storage", (event) => {
    // PostHog and the game both write heavily to localStorage. Reacting to all
    // of those writes caused cross-tab `$opt_in` feedback loops.
    if (event.key === CONSENT_KEY) applyConsent();
  });
  scheduleIdleLoad();
}

/** Called on client-side route changes; the first real navigation loads the SDK. */
export function notifyRouteChange() {
  if (state !== "scheduled" || !landing) return;
  if (window.location.pathname !== landing.pathname) load();
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
 * Fire-and-forget event capture. Drops events not in POSTHOG_EVENTS, buffers
 * (up to 50, with their original timestamps) until the SDK has loaded and
 * starts that load, no-ops without a key or after a failed load, never throws.
 */
export function capture(event, properties) {
  if (!isAllowedEvent(event)) return;
  if (state === "ready") {
    try {
      client.capture(event, properties);
    } catch {
      /* analytics must never break the game */
    }
    return;
  }
  if (state !== "scheduled" && state !== "loading") return;
  if (getConsent() === "rejected") return;
  if (buffer.length < MAX_BUFFERED) {
    buffer.push({
      event,
      properties,
      timestamp: new Date(),
      href: window.location.href,
      pathname: window.location.pathname,
    });
  }
  load();
}
