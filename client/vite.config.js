import { readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build, defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'

// Body text font (see the @font-face rules in src/index.css).
const PRELOAD_FONT = /^assets\/plus-jakarta-sans-latin-wght-normal-[\w-]+\.woff2$/

/**
 * Adds <link rel="preload"> for the hashed latin body font so it downloads
 * while the HTML is still parsing, instead of after the CSS is applied.
 * Fails the build if the font file is missing, so a rename can't silently
 * drop the preload.
 */
function preloadBodyFont() {
  return {
    name: 'preload-body-font',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const file = Object.keys(ctx.bundle ?? {}).find((name) => PRELOAD_FONT.test(name))
        if (!file) throw new Error('preload-body-font: latin font asset not found in bundle')
        return [
          {
            tag: 'link',
            attrs: { rel: 'preload', href: `/${file}`, as: 'font', type: 'font/woff2', crossorigin: '' },
            injectTo: 'head',
          },
        ]
      },
    },
  }
}

// Homepage covers stay separate files (never base64 in the JS bundle),
// whatever their size. Everything else keeps Vite's default limit.
const ASSETS_INLINE_LIMIT = (filePath) => (filePath.includes('/homepage-albums/') ? false : undefined)

const escapeHtml = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Replaces one required match in html; throws if index.html lost the tag. */
function swap(html, pattern, replacement) {
  if (!pattern.test(html)) throw new Error(`prerender-pages: ${pattern} not found in index.html`)
  // A function replacement, so "$" in page text is never read as a pattern.
  return html.replace(pattern, typeof replacement === 'function' ? replacement : () => replacement)
}

/** index.html with a page's own title, description and URL in the head. */
function pageHead(html, page, site) {
  if (!page.title) return html
  const title = escapeHtml(page.title)
  html = swap(html, /<title>[^<]*<\/title>/, `<title>${title}</title>`)
  for (const name of ['og:title', 'twitter:title']) {
    html = swap(html, new RegExp(`(<meta property="${name}" content=")[^"]*(")`), (_, a, b) => `${a}${title}${b}`)
  }
  if (page.description) {
    const description = escapeHtml(page.description)
    for (const attr of ['name="description"', 'property="og:description"', 'property="twitter:description"']) {
      html = swap(html, new RegExp(`(<meta ${attr} content=")[^"]*(")`), (_, a, b) => `${a}${description}${b}`)
    }
  }
  if (page.index) {
    const url = `${site}${page.path}`
    html = swap(html, /(<link rel="canonical" href=")[^"]*(")/, (_, a, b) => `${a}${url}${b}`)
    for (const name of ['og:url', 'twitter:url']) {
      html = swap(html, new RegExp(`(<meta property="${name}" content=")[^"]*(")`), (_, a, b) => `${a}${url}${b}`)
    }
  }
  return html
}

/** Drops the home canonical and marks the document noindex. */
function noIndexHead(html) {
  html = swap(html, /\s*<link rel="canonical" href="[^"]*" \/>/, '')
  return swap(html, /<\/head>/, '  <meta name="robots" content="noindex, nofollow" />\n  </head>')
}

/**
 * After the client build, renders each page in src/data/pages.js to static
 * HTML: the built index.html with the page's own head, and the page's real
 * markup in #root, so crawlers get the text without running JS. React still
 * mounts with createRoot and replaces the markup with an identical first
 * render. Also writes app.html, the noindex shell that vercel.json serves for
 * lobby, screen, results and other app-only routes.
 *
 * The pages come from a separate Node build of src/prerender/entry.jsx that
 * shares this build's asset settings, so asset URLs (hashed album covers)
 * match the client bundle. That build swaps convex/react for a stub.
 */
function prerenderPages() {
  let config
  return {
    name: 'prerender-pages',
    apply: 'build',
    configResolved(resolved) {
      config = resolved
    },
    async closeBundle() {
      const { PAGES, SITE } = await import('./src/data/pages.js')
      const root = config.root
      const outDir = resolve(root, config.build.outDir)
      const ssrDir = resolve(root, 'node_modules/.prerender')
      await build({
        configFile: false,
        root,
        mode: config.mode,
        logLevel: 'warn',
        plugins: [react()],
        resolve: {
          alias: { 'convex/react': resolve(root, 'src/prerender/convexStub.js') },
        },
        build: {
          ssr: 'src/prerender/entry.jsx',
          outDir: ssrDir,
          emptyOutDir: true,
          copyPublicDir: false,
          assetsInlineLimit: ASSETS_INLINE_LIMIT,
        },
      })
      try {
        const { render } = await import(`${pathToFileURL(join(ssrDir, 'entry.js')).href}?t=${Date.now()}`)
        const template = await readFile(join(outDir, 'index.html'), 'utf8')
        for (const page of PAGES) {
          let html = pageHead(template, page, SITE)
          if (!page.index) html = noIndexHead(html)
          const markup = render(page.path)
          html = swap(html, /<div id="root"><\/div>/, () => `<div id="root">${markup}</div>`)
          await writeFile(join(outDir, page.file), html)
        }
        await writeFile(join(outDir, 'app.html'), noIndexHead(template))
      } finally {
        await rm(ssrDir, { recursive: true, force: true })
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    preloadBodyFont(),
    prerenderPages(),
  ],
  build: {
    assetsInlineLimit: ASSETS_INLINE_LIMIT,
  },
  server: {
    fs: {
      // allow importing Convex generated API types from project root
      allow: ['..']
    },
    proxy: {
      '/convex': {
        target: 'http://127.0.0.1:3210',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/convex/, '')
      },
      '/api': {
        target: 'http://localhost:3002',
        changeOrigin: true
      }
    }
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/setupTests.js'],
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
})
