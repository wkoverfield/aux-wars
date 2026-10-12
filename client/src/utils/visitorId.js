// Persistent anonymous visitor id, shared by feedback + analytics so a
// "visitor" is consistent across both. Key matches the original inline
// helper in FeedbackModal.jsx.
const KEY = "aux-wars-visitor-id";

export function getVisitorId() {
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id =
        (typeof crypto !== "undefined" && crypto.randomUUID && crypto.randomUUID()) ||
        `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return "anon";
  }
}

let fallbackVoterId = null;

/**
 * Visitor id for actions that are owned by the visitor (feedback posts and
 * upvotes). Same stored id as getVisitorId, but when storage is unavailable
 * it is a random id kept for this page load instead of the shared "anon":
 * a shared id would let one such visitor see and undo another's votes.
 */
export function getVoterId() {
  const id = getVisitorId();
  if (id !== "anon") return id;
  if (!fallbackVoterId) {
    fallbackVoterId =
      (typeof crypto !== "undefined" && crypto.randomUUID && crypto.randomUUID()) ||
      `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
  return fallbackVoterId;
}
