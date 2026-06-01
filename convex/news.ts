import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";

/**
 * Homepage News section.
 *
 * Post an update (no code deploy needed):
 *   npx convex run news:addNews '{"title":"Bigger song search","body":"..."}'
 * (add --prod to post to production). Internal so only you (via CLI/dashboard)
 * can publish — players can only read.
 */

/** Public: latest published news, newest first. */
export const getRecentNews = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit = 10 }) => {
    const items = await ctx.db
      .query("news")
      .withIndex("by_published", (q) => q.eq("published", true))
      .order("desc")
      .take(limit);
    return items.map((n) => ({
      id: n._id,
      title: n.title,
      body: n.body,
      publishedAt: n.publishedAt,
    }));
  },
});

/** Internal: publish a news update. */
export const addNews = internalMutation({
  args: { title: v.string(), body: v.string(), publishedAt: v.optional(v.number()) },
  handler: async (ctx, { title, body, publishedAt }) => {
    const id = await ctx.db.insert("news", {
      title,
      body,
      publishedAt: publishedAt ?? Date.now(),
      published: true,
    });
    return { id };
  },
});

/** Internal: unpublish/hide a news entry by id. */
export const setPublished = internalMutation({
  args: { id: v.id("news"), published: v.boolean() },
  handler: async (ctx, { id, published }) => {
    await ctx.db.patch(id, { published });
  },
});
