import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { Analytics } from "@vercel/analytics/react"
import { ConvexProvider, ConvexReactClient } from 'convex/react'

const convexUrl = import.meta.env.VITE_CONVEX_URL
const convex = convexUrl ? new ConvexReactClient(convexUrl) : null

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