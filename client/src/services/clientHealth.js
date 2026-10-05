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

/** Error class name only: never the message or stack. */
export function errorName(error, fallback = "Error") {
  const name = error && typeof error === "object" ? error.name : undefined;
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

/** Builds the web_vital metadata for a web-vitals Metric. */
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
    import("web-vitals")
      .then(({ onLCP, onINP, onCLS, onFCP, onTTFB }) => {
        onLCP(reportVital);
        onINP(reportVital);
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
