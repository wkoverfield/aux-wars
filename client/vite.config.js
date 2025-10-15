import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss()
  ],
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
        target: 'http://localhost:3001',
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
