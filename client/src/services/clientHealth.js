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

/** Reports an uncaught error, at most MAX_ERRORS_PER_LOAD per page load. */
export function reportClientError(error, fallback = "Error") {
  if (errorsSent >= MAX_ERRORS_PER_LOAD) return;
  errorsSent += 1;
  send("client_error", { name: errorName(error, fallback), route: currentRoute() });
}

/** Called from ErrorBoundary.componentDidCatch. Same per-load cap. */
export function reportBoundaryError(error) {
  if (boundarySent >= MAX_ERRORS_PER_LOAD) return;
  boundarySent += 1;
  send("client_error_boundary", { name: errorName(error), route: currentRoute() });
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
    if (typeof a.interactionTarget === "string" && a.interactionTarget) meta.target = a.interactionTarget;
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
    reportClientError(event.error, event.error ? "Error" : "ScriptError");
  });
  window.addEventListener("unhandledrejection", (event) => {
    reportClientError(event?.reason, "UnhandledRejection");
  });

  if (random() < sampleRate) {
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
}
