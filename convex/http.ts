import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";

const http = httpRouter();

/**
 * Verify a Stripe webhook signature (HMAC-SHA256) without the Stripe SDK,
 * using Web Crypto (available in Convex's default runtime).
 * Header format: "t=<timestamp>,v1=<hex signature>".
 */
async function verifyStripeSignature(
  payload: string,
  sigHeader: string,
  secret: string,
): Promise<boolean> {
  const parts: Record<string, string> = {};
  for (const kv of sigHeader.split(",")) {
    const idx = kv.indexOf("=");
    if (idx > 0) parts[kv.slice(0, idx)] = kv.slice(idx + 1);
  }
  const timestamp = parts["t"];
  const expected = parts["v1"];
  if (!timestamp || !expected) return false;
  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${payload}`),
  );
  const computed = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // length-safe constant-time-ish comparison
  if (computed.length !== expected.length) return false;
  let mismatch = 0;
  for (let i = 0; i < computed.length; i++) {
    mismatch |= computed.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Stripe webhook — the reliable fulfillment path. On checkout.session.completed
 * we create the entitlement server-side regardless of whether the buyer's
 * browser made it back to /pro/success. Reuses the idempotent verifyCheckout.
 */
http.route({
  path: "/stripe/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const payload = await request.text();
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    const sigHeader = request.headers.get("stripe-signature") || "";

    if (!secret) return new Response("Webhook secret is not configured", { status: 500 });

    const ok = await verifyStripeSignature(payload, sigHeader, secret);
    if (!ok) return new Response("Invalid signature", { status: 400 });

    let event: { type?: string; data?: { object?: { id?: string } } };
    try {
      event = JSON.parse(payload);
    } catch {
      return new Response("Invalid payload", { status: 400 });
    }

    if (event?.type === "checkout.session.completed") {
      const sessionId = event?.data?.object?.id;
      if (sessionId) {
        await ctx.runAction(api.stripe.verifyCheckout, { sessionId });
      }
    }

    return new Response("ok", { status: 200 });
  }),
});

export default http;
