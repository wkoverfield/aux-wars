/**
 * sitemap.xml for the build: one <url> per page with `index: true`, static
 * pages (data/pages.js) and content pages (data/contentPages.js) alike.
 */
const escapeXml = (text) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

export function sitemapXml(pages, site) {
  const urls = pages
    .filter((page) => page.index)
    .map((page) => `  <url>\n    <loc>${escapeXml(`${site}${page.path}`)}</loc>\n  </url>`);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...urls,
    "</urlset>",
    "",
  ].join("\n");
}
