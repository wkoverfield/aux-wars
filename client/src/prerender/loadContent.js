/**
 * Build-time read of the published content from Convex.
 *
 * Calls the public query `content:published` over the Convex HTTP API:
 *   POST {convexUrl}/api/query
 *   { path: "content:published", args: { section, cursor? }, format: "json" }
 * The value is `{ items, cursor }`. Each section ("songs", "artists",
 * "charts") is read page by page until `cursor` is null.
 *
 * Throws when the URL is missing, a request fails, a response is not the
 * expected shape, or there are zero songs. The prerender plugin lets the
 * error fail the build: a deploy must never replace the published pages with
 * nothing.
 */
const QUERY_PATH = "content:published";
const SECTIONS = ["songs", "artists", "charts"];
const MAX_PAGES = 1000;
const REQUEST_TIMEOUT_MS = 30_000;

async function readPage(endpoint, section, cursor, fetchImpl) {
  const args = cursor === null ? { section } : { section, cursor };
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: QUERY_PATH, args, format: "json" }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`content: fetching ${section} from ${endpoint} failed: ${error.message}`);
  }
  if (!response.ok) {
    throw new Error(`content: fetching ${section} from ${endpoint} returned HTTP ${response.status}`);
  }
  const body = await response.json();
  if (body?.status !== "success") {
    throw new Error(`content: ${QUERY_PATH} failed for ${section}: ${body?.errorMessage ?? "unknown error"}`);
  }
  const { items, cursor: next } = body.value ?? {};
  if (!Array.isArray(items) || (next !== null && typeof next !== "string")) {
    throw new Error(`content: ${QUERY_PATH} returned an unexpected shape for ${section}`);
  }
  return { items, next };
}

async function readSection(endpoint, section, fetchImpl) {
  const all = [];
  let cursor = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { items, next } = await readPage(endpoint, section, cursor, fetchImpl);
    all.push(...items);
    if (next === null) return all;
    if (next === cursor) throw new Error(`content: ${QUERY_PATH} repeated a cursor for ${section}`);
    cursor = next;
  }
  throw new Error(`content: ${QUERY_PATH} did not finish ${section} in ${MAX_PAGES} pages`);
}

/**
 * @param {string} convexUrl - the deployment URL (VITE_CONVEX_URL)
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ songs: object[], artists: object[], charts: object[] }>}
 */
export async function loadPublishedContent(convexUrl, fetchImpl = fetch) {
  if (!convexUrl) throw new Error("content: VITE_CONVEX_URL is not set, so the content pages cannot be built");
  const endpoint = `${convexUrl.replace(/\/+$/, "")}/api/query`;
  const content = {};
  for (const section of SECTIONS) {
    content[section] = await readSection(endpoint, section, fetchImpl);
  }
  if (content.songs.length === 0) {
    throw new Error(`content: ${QUERY_PATH} returned zero songs from ${endpoint}`);
  }
  return content;
}
