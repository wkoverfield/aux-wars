import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { Analytics } from "@vercel/analytics/react"
import { ConvexProvider, ConvexReactClient } from 'convex/react'
import { initPostHog } from './services/posthog'
import { initClientHealth } from './services/clientHealth'

const convexUrl = import.meta.env.VITE_CONVEX_URL
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null

// Product analytics: pageviews, the game funnel, and sampled replays (usage
// counts live in Convex). No-ops without VITE_POSTHOG_KEY, so local dev is
// unaffected.
initPostHog()

// Sampled web vitals and uncaught-error counts, reported to Convex.
initClientHealth(convex)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {convex ? (
      <ConvexProvider client={convex}>
        <App />
        <Analytics />
      </ConvexProvider>
    ) : (
      <>
        <App />
        <Analytics />
      </>
    )}
  </StrictMode>,
)