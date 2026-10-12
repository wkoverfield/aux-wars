import { api } from "../../../convex/_generated/api";

/**
 * Client health reporting through the Convex analytics logEvent mutation:
 * sampled web vitals, uncaught errors, and React error boundary catches.
 *
 * Nothing here carries PII: routes are reduced to patterns (room codes
 * removed), errors to their class name, and devices to a coarse class.
 * Every send is fire-and-forget; reporting must never throw into the app.
 */

export const VITALS_SAMPLE_RATE = 0.25;
export const MAX_ERRORS_PER_LOAD = 3;

let convexClient = null;
let errorsSent = 0;
let boundarySent = 0;

const STATIC_ROUTES = new Set(["/", "/privacy", "/pro/success", "/pro/restore", "/stats"]);
const LOBBY_SUBROUTES = new Set(["round", "results", "gamewinner"]);

/** Route pattern for a pathname, with the room code replaced by ":code". */
export function routePattern(pathname) {
  const path = String(pathname || "/").replace(/\/+$/, "") || "/";
  if (STATIC_ROUTES.has(path)) return path;
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "lobby" && parts.length === 2) return "/lobby/:code";
  if (parts[0] === "g" && parts.length === 2) return "/g/:id";
  if (parts[0] === "lobby" && parts.length === 3 && LOBBY_SUBROUTES.has(parts[2])) {
    return `/lobby/:code/${parts[2]}`;
  }
  return "other";
}

/** Coarse device class: "chromebook", "mobile" or "desktop". */
export function deviceClass(nav = typeof navigator === "undefined" ? undefined : navigator) {
  const ua = String(nav?.userAgent || "");
  if (/CrOS/.test(ua)) return "chromebook";
  if (/Mobi|Android|iPhone|iPad/.test(ua)) return "mobile";
  return "desktop";
}

function effectiveType(nav = typeof navigator === "undefined" ? undefined : navigator) {
  const t = nav?.connection?.effectiveType;
  return typeof t === "string" ? t : undefined;
}

function currentRoute() {
  return routePattern(typeof window === "undefined" ? "/" : window.location.pathname);
}

function send(eventType, metadata) {
  if (!convexClient) return;
  try {
    const result = convexClient.mutation(api.analytics.logEvent, { eventType, metadata });
    if (result && typeof result.catch === "function") result.catch(() => {});
  } catch {
    // Reporting is best effort.
  }
}

// Generic errors are told apart by their message so the report says what
// failed. Only the resulting label is sent, never the message itself.
const ERROR_KINDS = [
  // A Convex query, mutation or action failed on the server.
  { name: "ConvexServerError", test: /^\[CONVEX [QMA]\(|\[Request ID: / },
  // A lazy chunk from an older deploy is gone.
  { name: "ChunkLoadError", test: /dynamically imported module|Importing a module script failed|error loading dynamically imported/i },
  // fetch() itself failed (offline, blocked, CORS).
  { name: "NetworkError", test: /^(Failed to fetch|Load failed|NetworkError when attempting to fetch)/ },
];

/** Error class name only (or a kind derived from the message): never the message or stack. */
export function errorName(error, fallback = "Error") {
  const isObject = error && typeof error === "object";
  const message = isObject && typeof error.message === "string" ? error.message : "";
  if (message) {
    const kind = ERROR_KINDS.find((k) => k.test.test(message));
    if (kind) return kind.name;
  }
  const name = isObject ? error.name : undefined;
  return typeof name === "string" && /^[A-Za-z_$][A-Za-z0-9_$]{0,40}$/.test(name) ? name : fallback;
}

const BUILT_FILE_RE = /\/assets\/([A-Za-z0-9_.]{1,32}-[A-Za-z0-9_-]{8})\.js$/;
const FRAME_RE = /((?:https?|chrome-extension|moz-extension|safari-web-extension):\/\/[^\s)]+?):(\d+):(\d+)/;

/**
 * Where an error was thrown, from the first URL in its stack (or a script
 * URL from an error event): the source bucket, and for the app's own code
 * the position in the built file, e.g. "index-D9bxC1pi:42:13337". That is a
 * code location (the hash names the build), not page or user data: page URLs
 * never contribute to it.
 */
export function errorOrigin(error, fileUrl, origin) {
  const stack = error && typeof error === "object" && typeof error.stack === "string" ? error.stack : "";
  const frame = FRAME_RE.exec(stack);
  const url = frame ? frame[1] : fileUrl;
  const script = scriptSource(url, origin);
  if (!script) return {};
  const out = { script };
  if (script === "app" && frame) {
    // Only a built file under /assets/ ("name-hash.js") gets a position. A
    // frame that points at the page itself (inline or injected script) would
    // otherwise report the last path segment, which on a lobby is the room code.
    const built = BUILT_FILE_RE.exec(url.split(/[?#]/)[0]);
    if (built) out.label = `${built[1]}:${frame[2]}:${frame[3]}`;
  }
  return out;
}

/**
 * Reports an uncaught error, at most MAX_ERRORS_PER_LOAD per page load.
 * `reason` is how it surfaced ("uncaught" or "rejection"); `fileUrl` is the
 * script URL of an error event that carried no error object.
 */
export function reportClientError(error, fallback = "Error", { reason, fileUrl } = {}) {
  if (errorsSent >= MAX_ERRORS_PER_LOAD) return;
  errorsSent += 1;
  const meta = { name: errorName(error, fallback), route: currentRoute(), ...errorOrigin(error, fileUrl) };
  if (reason) meta.reason = reason;
  send("client_error", meta);
}

/** Called from ErrorBoundary.componentDidCatch. Same per-load cap. */
export function reportBoundaryError(error) {
  if (boundarySent >= MAX_ERRORS_PER_LOAD) return;
  boundarySent += 1;
  send("client_error_boundary", { name: errorName(error), route: currentRoute(), ...errorOrigin(error) });
}

/** Rounds a vital for transport: whole ms for timings, 3 places for CLS. */
export function roundVital(name, value) {
  return name === "CLS" ? Math.round(value * 1000) / 1000 : Math.round(value);
}

const VITAL_LABEL_RE = /^[a-z0-9-]{1,24}$/;
const CONTROL_SELECTOR = "button, a, input, textarea, select, label, [role=button]";

/**
 * Label for an interaction target: up to two enclosing data-vital names
 * (outermost first) and the tag of the control that was hit, e.g.
 * "rating>record:button". Built from the app's own markup only, so it never
 * carries page text such as player names or song titles.
 */
export function interactionLabel(node) {
  const el = node && node.nodeType === 1 ? node : node?.parentElement;
  if (!el || typeof el.closest !== "function") return undefined;
  const control = el.closest(CONTROL_SELECTOR) || el;
  const names = [];
  for (let cur = el.closest("[data-vital]"); cur && names.length < 2; cur = cur.parentElement?.closest("[data-vital]")) {
    const n = cur.getAttribute("data-vital");
    if (VITAL_LABEL_RE.test(n)) names.unshift(n);
  }
  return `${names.join(">")}:${control.tagName.toLowerCase().slice(0, 10)}`;
}

const INTERACTION_LABEL_RE = /^([a-z0-9-]{1,24}>){0,2}[a-z0-9-]{0,24}:[a-z]{1,10}$/;
const RECENT_INTERACTIONS = 20;
// A recorded label counts for an interaction that started within this long of it.
const INTERACTION_MATCH_MS = 100;
let recentInteractions = [];

/**
 * Notes the label of what a pointerdown or keydown hit, at the time it
 * happens. INP is attributed later, and by then a control that advanced the
 * screen has usually left the page, so its label can no longer be read.
 */
export function noteInteraction(event) {
  const label = interactionLabel(event?.target);
  if (!label || typeof event.timeStamp !== "number") return;
  recentInteractions.push({ time: event.timeStamp, label });
  if (recentInteractions.length > RECENT_INTERACTIONS) recentInteractions.shift();
}

/** The label noted closest to `time` (an interaction's start), if any is close enough. */
export function notedLabelAt(time) {
  if (typeof time !== "number") return undefined;
  let best;
  for (const r of recentInteractions) {
    const gap = Math.abs(r.time - time);
    if (gap <= INTERACTION_MATCH_MS && (!best || gap < best.gap)) best = { gap, label: r.label };
  }
  return best?.label;
}

/** Where the longest script in a slow interaction came from. */
export function scriptSource(url, origin = typeof location === "undefined" ? "" : location.origin) {
  if (typeof url !== "string" || !url) return undefined;
  if (/^(chrome|moz|safari-web)-extension:/.test(url)) return "extension";
  if (origin && url.startsWith(origin)) return "app";
  if (/^https:\/\/([a-z0-9-]+\.)*(youtube\.com|ytimg\.com|googlevideo\.com|youtube-nocookie\.com)\//.test(url)) return "youtube";
  return "third-party";
}

/** Builds the web_vital metadata for a web-vitals Metric (attribution build). */
export function vitalMetadata(metric, nav) {
  const meta = {
    name: metric.name,
    value: roundVital(metric.name, metric.value),
    rating: metric.rating,
    route: currentRoute(),
    deviceClass: deviceClass(nav),
  };
  const type = effectiveType(nav);
  if (type) meta.effectiveType = type;
  const a = metric.attribution;
  if (metric.name === "INP" && a) {
    // Prefer the label read at report time; when the element is gone (or the
    // library fell back to a CSS path), use the one noted when it was hit.
    const reported = typeof a.interactionTarget === "string" && INTERACTION_LABEL_RE.test(a.interactionTarget)
      ? a.interactionTarget
      : undefined;
    const noted = notedLabelAt(a.interactionTime);
    const target = reported && !reported.startsWith(":") ? reported : noted || reported;
    if (target) meta.target = target;
    if (a.interactionType) meta.interactionType = a.interactionType;
    for (const [key, ms] of [["inputDelay", a.inputDelay], ["processing", a.processingDuration], ["presentation", a.presentationDelay]]) {
      if (typeof ms === "number" && Number.isFinite(ms)) meta[key] = Math.round(ms);
    }
    const script = scriptSource(a.longestScript?.entry?.sourceURL);
    if (script) meta.script = script;
  }
  return meta;
}

function reportVital(metric) {
  send("web_vital", vitalMetadata(metric));
}

/**
 * Installs global error listeners and, for a sampled share of page loads,
 * web-vitals reporting (each metric once, when final). Safe to call without
 * a Convex client (local dev without VITE_CONVEX_URL): it then does nothing.
 */
export function initClientHealth(client, { sampleRate = VITALS_SAMPLE_RATE, random = Math.random } = {}) {
  if (!client || typeof window === "undefined") return;
  convexClient = client;

  window.addEventListener("error", (event) => {
    // Resource load failures (img/script 404s) bubble here without an error.
    if (!event || (!event.error && !event.message)) return;
    reportClientError(event.error, event.error ? "Error" : "ScriptError", {
      reason: "uncaught",
      fileUrl: event.filename,
    });
  });
  window.addEventListener("unhandledrejection", (event) => {
    reportClientError(event?.reason, "UnhandledRejection", { reason: "rejection" });
  });

  if (random() < sampleRate) {
    // Only sampled loads report INP, so only they note interactions.
    for (const type of ["pointerdown", "keydown"]) {
      window.addEventListener(type, noteInteraction, { capture: true, passive: true });
    }
    import("web-vitals/attribution")
      .then(({ onLCP, onINP, onCLS, onFCP, onTTFB }) => {
        onLCP(reportVital);
        // The target is our own label (see interactionLabel), not a CSS path.
        onINP(reportVital, { generateTarget: interactionLabel });
        onCLS(reportVital);
        onFCP(reportVital);
        onTTFB(reportVital);
      })
      .catch(() => {});
  }
}

/** Test hook: resets module state between tests. */
export function __resetClientHealthForTests() {
  convexClient = null;
  errorsSent = 0;
  boundarySent = 0;
  recentInteractions = [];
}
