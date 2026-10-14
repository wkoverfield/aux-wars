import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { defineConfig } from 'vite'
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

const SITE = 'https://www.aux-wars.com'

const escapeHtml = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * Writes faq.html next to index.html: the same app shell with the FAQ page's
 * own title, description, canonical and Open Graph URL, and its answers
 * already in #root (React replaces them on mount with the same markup, see
 * features/legal/Faq.jsx). vercel.json rewrites /faq to this file.
 */
function faqPage() {
  return {
    name: 'faq-page',
    apply: 'build',
    async writeBundle(options) {
      const { FAQ, FAQ_PAGE } = await import('./src/data/faq.js')
      const dir = options.dir
      let html = await readFile(join(dir, 'index.html'), 'utf8')
      const url = `${SITE}${FAQ_PAGE.path}`
      const title = escapeHtml(FAQ_PAGE.title)
      const description = escapeHtml(FAQ_PAGE.description)
      const swaps = [
        [/<title>[^<]*<\/title>/, `<title>${title}</title>`],
        [/(<meta name="description" content=")[^"]*(")/, `$1${description}$2`],
        [/(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`],
        [/(<meta property="og:url" content=")[^"]*(")/, `$1${url}$2`],
        [/(<meta property="og:title" content=")[^"]*(")/, `$1${title}$2`],
        [/(<meta property="og:description" content=")[^"]*(")/, `$1${description}$2`],
        [/(<meta property="twitter:url" content=")[^"]*(")/, `$1${url}$2`],
        [/(<meta property="twitter:title" content=")[^"]*(")/, `$1${title}$2`],
        [/(<meta property="twitter:description" content=")[^"]*(")/, `$1${description}$2`],
        [/<div id="root"><\/div>/, `<div id="root">${faqMarkup(FAQ)}</div>`],
      ]
      for (const [pattern, replacement] of swaps) {
        if (!pattern.test(html)) throw new Error(`faq-page: ${pattern} not found in index.html`)
        html = html.replace(pattern, replacement)
      }
      await writeFile(join(dir, 'faq.html'), html)
    },
  }
}

function faqMarkup(faq) {
  const items = faq
    .map(({ q, a }) => `<div><dt class="text-lg font-semibold text-white">${escapeHtml(q)}</dt><dd class="text-sm text-gray-300 leading-relaxed mt-1">${escapeHtml(a)}</dd></div>`)
    .join('')
  return `<div class="h-full w-full overflow-y-auto text-white px-6 py-12 flex justify-center"><div class="max-w-2xl w-full pb-16"><a href="/" class="text-[#68d570] underline text-sm">← Back to Aux Wars</a><h1 class="text-3xl font-bold mt-6 mb-8">Questions</h1><dl class="space-y-6">${items}</dl><a href="/" class="inline-block mt-10 py-3 px-6 rounded-full font-bold text-black bg-[#68d570] hover:bg-[#7de884] transition-colors">Play Aux Wars</a></div></div>`
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    preloadBodyFont(),
    faqPage(),
  ],
  build: {
    // Homepage covers stay separate files (never base64 in the JS bundle),
    // whatever their size. Everything else keeps Vite's default limit.
    assetsInlineLimit: (filePath) => (filePath.includes('/homepage-albums/') ? false : undefined),
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
