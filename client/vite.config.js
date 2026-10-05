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

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    preloadBodyFont(),
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
