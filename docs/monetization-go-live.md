# Aux Wars — Monetization Go-Live Checklist

Everything for monetization is built on branch `feat/monetization-foundation` (PR #5),
build + Convex typecheck green, and **dark by default** (no visible change until you flip
the switches below). This doc is the paint-by-numbers finish line.

## What's built
- **Music**: YouTube-powered full-song search + clip selection, with iTunes/Deezer preview fallback.
- **Host Pack ($5 one-time)**: Stripe Checkout → durable entitlement. Pro rooms are ad-free + cap 50
  (free = 8). Server is source of truth (webhook). Restore uses the post-purchase Pro code; email
  restore stays disabled until it is a real magic-link flow.
- **Ads (dark)**: AdSense `<AdSlot>` on Home, Lobby (private and public), Waiting, /faq and
  /aux-battle. Never on a screen that shows YouTube API data (song pick, rating, round results,
  game over) and never on /screen; the rule is in `client/src/services/ads.js`. Auto-suppressed in
  Pro rooms. Consent comes from Google's CMP (AdSense Privacy & messaging); the app has no banner of
  its own. Renders nothing until `VITE_ADSENSE_CLIENT` and placement slot IDs are set.
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
- [ ] Set Stripe secret key: `npx convex env set STRIPE_SECRET_KEY sk_live_… --prod`
- [ ] Copy the webhook signing secret and set it:
      `npx convex env set STRIPE_WEBHOOK_SECRET whsec_… --prod`
- [ ] Optional if adding custom domains/dev URLs beyond defaults:
      `npx convex env set AUX_WARS_ALLOWED_ORIGINS https://aux-wars.com,https://www.aux-wars.com --prod`
- [ ] ⚠️ dev Convex = `sk_test_` / test `whsec_`; prod Convex = `sk_live_` / live `whsec_`. Never mix.

### 3. Turn on ads (when AdSense approves)
- [ ] Apply to AdSense with `aux-wars.com` (the `/privacy` page is live for this)
- [ ] On approval, set `VITE_ADSENSE_CLIENT=ca-pub-…` in Vercel prod.
- [ ] Set placement slot IDs in Vercel prod:
      `VITE_ADSENSE_SLOT_HOME`, `VITE_ADSENSE_SLOT_LOBBY`, `VITE_ADSENSE_SLOT_WAIT`,
      `VITE_ADSENSE_SLOT_FAQ`, `VITE_ADSENSE_SLOT_AUX_BATTLE`.
- [ ] In AdSense > Privacy & messaging, publish the European regulations message (Google's
      certified CMP) and the US state regulations message.
- [ ] Keep Auto ads off: they would place ads on screens that show YouTube data.
- [ ] Add `client/public/ads.txt` with the line AdSense gives you.
- [ ] Redeploy Vercel. Ads stay dark unless the client id and placement slot ids
      are configured. The Pro CTA appears when AdSense is configured; Stripe remains ready but hidden
      before then.

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
- Email magic-link restore / anti-sharing device cap (only if sharing or cleared-storage restore pain
  shows up in the data)
- Lightweight email accounts (only if cleared-storage restore becomes a real pain)

## The actual priority after launch: GROWTH
Every revenue line multiplies with traffic. Cheapest levers: shareable winner cards,
"X games happening now," one-tap rematch, Reddit/TikTok, and the SEO that's already working.
Ads ≈ $40/mo today; host pack is the bigger lever; both ride growth. Target ~5–10× for ~$1k/mo.
