# Aux Wars — Monetization Go-Live Checklist

Everything for monetization is built on branch `feat/monetization-foundation` (PR #5),
build + Convex typecheck green, and **dark by default** (no visible change until you flip
the switches below). This doc is the paint-by-numbers finish line.

## What's built
- **Music**: YouTube scraping → iTunes + Deezer 30s previews (HTML5 audio). Kills the YouTube ToS
  blocker for ads and removes YouTube's own pre-roll ads. (Tested live.)
- **Host Pack ($5 one-time)**: Stripe Checkout → durable entitlement. Pro rooms are ad-free + cap 50
  (free = 8). Server is source of truth (webhook), with restore-by-email/code on any device.
- **Ads (dark)**: AdSense `<AdSlot>` on Home, Lobby, Waiting, Results, Game-over. Never on
  song-pick/rating. Auto-suppressed in Pro rooms + behind cookie consent. Renders nothing until
  `VITE_ADSENSE_CLIENT` is set. Game-over slot reserved for a future end-game video (at scale).
- **Tip jar**: Buy Me a Coffee, already live on the homepage.
- **Analytics**: pro funnel (cta→checkout→purchased), `search_no_results`+query, `vote_listen` ms,
  `game_abandoned`+phase (the 53%), `session_start` new/returning.

## Go-live steps

### 1. Merge + deploy PR #5
- [ ] Review/merge PR #5 → `main`
- [ ] Vercel auto-deploys web
- [ ] Redeploy the music server on Railway (`npm run deploy:server`) — it moved off YouTube
- [ ] `npx convex deploy` (pushes `entitlements` + `hostPro` + stripe/webhook functions to prod)

### 2. Turn on the Host Pack (Stripe)
- [ ] Finish Stripe activation; use the **family mailbox** as the public support address
- [ ] Enable Stripe **email receipts** (Settings → Customer emails → successful payments) — this is
      how buyers always have their email on record to restore
- [ ] **Webhook**: Stripe → Developers → Webhooks → Add endpoint
      - URL: `https://<PROD-DEPLOYMENT>.convex.site/stripe/webhook`
      - Event: `checkout.session.completed`
      - Copy signing secret → `npx convex env set STRIPE_SECRET_KEY sk_live_… --prod`
        and `npx convex env set STRIPE_WEBHOOK_SECRET whsec_… --prod`
- [ ] ⚠️ dev Convex = `sk_test_` / test `whsec_`; prod Convex = `sk_live_` / live `whsec_`. Never mix.

### 3. Turn on ads (when AdSense approves)
- [ ] Apply to AdSense with `aux-wars.com` (the `/privacy` page is live for this)
- [ ] On approval: set `VITE_ADSENSE_CLIENT=ca-pub-…` in Vercel prod → redeploy. This single switch
      reveals everything monetization at once: ads light up, the cookie banner appears, **and the Pro
      CTA ("Go Pro — ad-free + bigger rooms" + Restore) becomes visible.** Before this, the Pro CTA is
      hidden on purpose — "ad-free" only makes sense once there are ads to remove, so we don't show
      the offer (or charge) until ads are live. The Stripe backend stays fully built/ready meanwhile.

## After launch — watch, don't guess
A week of real data answers the open questions (query `convex/analytics.ts`):
- **Conversion**: `pro_cta_viewed` → `pro_checkout_started` → `pro_purchased`
- **Catalog churn risk**: `search_no_results` (the queries iTunes/Deezer can't fill)
- **Clip length**: `vote_listen` median ms → set the rating clip length from real behavior
- **The 53%**: `game_abandoned` by `phase` → is it benign drop-off or a fixable bottleneck?
- **Retention**: `session_start` new vs returning

## Deferred (build only if data says so)
- Snippet trim-within-30s (low value if `vote_listen` shows people vote fast)
- End-game video (needs a gaming ad network ~100k+ pageviews/mo)
- Restore-Pro link in lobby/Settings (currently on Home + /pro/success)
- Anti-sharing device cap / magic-link (only if sharing shows up in the data)
- Lightweight email accounts (only if cleared-storage restore becomes a real pain)

## The actual priority after launch: GROWTH
Every revenue line multiplies with traffic. Cheapest levers: shareable winner cards,
"X games happening now," one-tap rematch, Reddit/TikTok, and the SEO that's already working.
Ads ≈ $40/mo today; host pack is the bigger lever; both ride growth. Target ~5–10× for ~$1k/mo.
