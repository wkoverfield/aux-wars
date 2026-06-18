import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";

/**
 * Get all feedback sorted by upvotes (highest first)
 */
export const getFeedback = query({
  args: {},
  handler: async (ctx) => {
    const feedback = await ctx.db.query("feedback").collect();

    const childrenByParent = new Map<string, typeof feedback>();
    for (const item of feedback) {
      if (!item.mergedInto) continue;
      const parentId = item.mergedInto;
      childrenByParent.set(parentId, [...(childrenByParent.get(parentId) || []), item]);
    }

    const parentItems = feedback
      .filter((item) => !item.mergedInto)
      .map((item) => {
        const mergedRequests = (childrenByParent.get(item._id) || []).sort(
          (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        const upvoterIds = Array.from(
          new Set([
            ...item.upvoterIds,
            ...mergedRequests.flatMap((request) => request.upvoterIds),
          ])
        );

        return {
          ...item,
          mergedRequests,
          upvotes: upvoterIds.length,
          upvoterIds,
        };
      });

    // Sort by upvotes descending, then by createdAt descending.
    return parentItems.sort((a, b) => {
      if (b.upvotes !== a.upvotes) return b.upvotes - a.upvotes;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  },
});

/**
 * Submit new feedback
 */
export const submitFeedback = mutation({
  args: {
    type: v.string(),
    title: v.string(),
    description: v.string(),
    authorName: v.optional(v.string()),
    visitorId: v.string(),
  },
  handler: async (ctx, args) => {
    // Validate inputs
    if (!args.title.trim() || args.title.length > 100) {
      throw new Error("Title must be 1-100 characters");
    }
    if (!args.description.trim() || args.description.length > 500) {
      throw new Error("Description must be 1-500 characters");
    }
    if (!["feature", "bug", "improvement", "other"].includes(args.type)) {
      throw new Error("Invalid feedback type");
    }

    await ctx.db.insert("feedback", {
      type: args.type,
      title: args.title.trim(),
      description: args.description.trim(),
      status: "pending",
      upvotes: 1, // Auto-upvote by creator
      upvoterIds: [args.visitorId],
      authorName: args.authorName?.trim() || undefined,
      createdAt: new Date().toISOString(),
    });

    return { success: true };
  },
});

/**
 * Upvote feedback (one vote per visitor)
 */
export const upvoteFeedback = mutation({
  args: {
    feedbackId: v.id("feedback"),
    visitorId: v.string(),
  },
  handler: async (ctx, args) => {
    const feedback = await ctx.db.get(args.feedbackId);
    if (!feedback) {
      throw new Error("Feedback not found");
    }

    const childRequests = await ctx.db
      .query("feedback")
      .filter((q) => q.eq(q.field("mergedInto"), args.feedbackId))
      .collect();
    const hasVotedOnMergedRequest = childRequests.some((item) =>
      item.upvoterIds.includes(args.visitorId)
    );

    // Check if already voted
    if (feedback.upvoterIds.includes(args.visitorId) || hasVotedOnMergedRequest) {
      return { success: false, message: "Already voted" };
    }

    // Add vote
    await ctx.db.patch(args.feedbackId, {
      upvotes: feedback.upvotes + 1,
      upvoterIds: [...feedback.upvoterIds, args.visitorId],
    });

    return { success: true };
  },
});

/**
 * Update feedback status (admin only - no auth check for now)
 */
export const updateStatus = mutation({
  args: {
    feedbackId: v.id("feedback"),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    if (!["pending", "planned", "completed", "declined"].includes(args.status)) {
      throw new Error("Invalid status");
    }
    await ctx.db.patch(args.feedbackId, { status: args.status });
    return { success: true };
  },
});

/**
 * Merge duplicate feedback into a canonical request.
 *
 * The child rows stay in the database and are returned nested under the parent
 * by getFeedback, so people can still see their original request counted.
 */
export const mergeFeedback = internalMutation({
  args: {
    parentId: v.id("feedback"),
    childIds: v.array(v.id("feedback")),
    status: v.optional(v.string()),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const parent = await ctx.db.get(args.parentId);
    if (!parent) {
      throw new Error("Parent feedback not found");
    }
    if (args.status && !["pending", "planned", "completed", "declined"].includes(args.status)) {
      throw new Error("Invalid status");
    }
    if (args.title !== undefined && (!args.title.trim() || args.title.length > 100)) {
      throw new Error("Title must be 1-100 characters");
    }
    if (
      args.description !== undefined &&
      (!args.description.trim() || args.description.length > 500)
    ) {
      throw new Error("Description must be 1-500 characters");
    }

    const patch: {
      status?: string;
      title?: string;
      description?: string;
    } = {};
    if (args.status) patch.status = args.status;
    if (args.title !== undefined) patch.title = args.title.trim();
    if (args.description !== undefined) patch.description = args.description.trim();
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(args.parentId, patch);
    }

    const nowIso = new Date().toISOString();
    for (const childId of args.childIds) {
      if (childId === args.parentId) continue;
      const child = await ctx.db.get(childId);
      if (!child) continue;
      await ctx.db.patch(childId, {
        mergedInto: args.parentId,
        mergedAt: nowIso,
        status: args.status || parent.status,
      });
    }

    return { success: true };
  },
});

/**
 * Remove upvote (toggle)
 */
export const removeUpvote = mutation({
  args: {
    feedbackId: v.id("feedback"),
    visitorId: v.string(),
  },
  handler: async (ctx, args) => {
    const feedback = await ctx.db.get(args.feedbackId);
    if (!feedback) {
      throw new Error("Feedback not found");
    }

    // Check if has voted
    const childRequests = await ctx.db
      .query("feedback")
      .filter((q) => q.eq(q.field("mergedInto"), args.feedbackId))
      .collect();
    const childrenWithVote = childRequests.filter((item) =>
      item.upvoterIds.includes(args.visitorId)
    );

    if (!feedback.upvoterIds.includes(args.visitorId) && childrenWithVote.length === 0) {
      return { success: false, message: "Not voted" };
    }

    if (feedback.upvoterIds.includes(args.visitorId)) {
      await ctx.db.patch(args.feedbackId, {
        upvotes: Math.max(0, feedback.upvotes - 1),
        upvoterIds: feedback.upvoterIds.filter((id) => id !== args.visitorId),
      });
    }

    for (const child of childrenWithVote) {
      await ctx.db.patch(child._id, {
        upvotes: Math.max(0, child.upvotes - 1),
        upvoterIds: child.upvoterIds.filter((id) => id !== args.visitorId),
      });
    }

    return { success: true };
  },
});
