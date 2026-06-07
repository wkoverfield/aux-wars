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
