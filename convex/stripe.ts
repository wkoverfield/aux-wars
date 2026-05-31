import { action, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

/**
 * Stripe host-pack purchase + entitlement.
 *
 * Flow:
 *   1. Client calls createCheckoutSession -> we create a one-time Stripe Checkout
 *      session and return its hosted URL; client redirects there.
 *   2. After payment, Stripe redirects back to /pro/success?session_id=...
 *   3. Client calls verifyCheckout -> we confirm the session is paid, mint a
 *      proToken, and store an entitlement row. Client saves the token locally.
 *   4. hostGame (game/rooms.ts) validates the token and flags the room hostPro.
 *
 * We call Stripe's REST API with `fetch` (no SDK) so it runs in Convex's default
 * runtime. The secret key lives in the STRIPE_SECRET_KEY env var (never the client).
 */

const PRO_PACK_PRICE_CENTS = 500; // $5.00 one-time. Change here to reprice.
const PRO_PACK_NAME = "Aux Wars Pro — ad-free + bigger rooms";
const STRIPE_API = "https://api.stripe.com/v1";

function secretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
  return key;
}

/** Create a one-time Checkout Session and return its hosted URL. */
export const createCheckoutSession = action({
  args: { origin: v.string() },
  handler: async (_ctx, { origin }) => {
    const params = new URLSearchParams();
    params.set("mode", "payment");
    params.set("success_url", `${origin}/pro/success?session_id={CHECKOUT_SESSION_ID}`);
    params.set("cancel_url", `${origin}/`);
    params.set("line_items[0][quantity]", "1");
    params.set("line_items[0][price_data][currency]", "usd");
    params.set("line_items[0][price_data][unit_amount]", String(PRO_PACK_PRICE_CENTS));
    params.set("line_items[0][price_data][product_data][name]", PRO_PACK_NAME);

    const resp = await fetch(`${STRIPE_API}/checkout/sessions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey()}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    const data = await resp.json();
    if (!resp.ok) {
      throw new Error(data?.error?.message || "Failed to create checkout session");
    }
    return { url: data.url as string };
  },
});

/** Verify a completed checkout and issue a pro token (idempotent per session). */
export const verifyCheckout = action({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }): Promise<{ proToken: string | null; status?: string }> => {
    // Idempotency: if we've already recorded this session, return its token.
    const existing = await ctx.runQuery(internal.stripe.getEntitlementBySession, {
      stripeSessionId: sessionId,
    });
    if (existing) return { proToken: existing.proToken };

    const resp = await fetch(`${STRIPE_API}/checkout/sessions/${sessionId}`, {
      headers: { Authorization: `Bearer ${secretKey()}` },
    });
    const session = await resp.json();
    if (!resp.ok) {
      throw new Error(session?.error?.message || "Failed to retrieve session");
    }
    if (session.payment_status !== "paid") {
      return { proToken: null, status: session.payment_status };
    }

    const proToken = crypto.randomUUID();
    await ctx.runMutation(internal.stripe.recordEntitlement, {
      proToken,
      stripeSessionId: sessionId,
      email: session.customer_details?.email ?? undefined,
    });
    return { proToken };
  },
});

export const getEntitlementBySession = internalQuery({
  args: { stripeSessionId: v.string() },
  handler: async (ctx, { stripeSessionId }) => {
    return await ctx.db
      .query("entitlements")
      .withIndex("by_session", (q) => q.eq("stripeSessionId", stripeSessionId))
      .first();
  },
});

export const recordEntitlement = internalMutation({
  args: {
    proToken: v.string(),
    stripeSessionId: v.string(),
    email: v.optional(v.string()),
  },
  handler: async (ctx, { proToken, stripeSessionId, email }) => {
    await ctx.db.insert("entitlements", {
      proToken,
      stripeSessionId,
      email,
      active: true,
      createdAt: Date.now(),
    });
  },
});
