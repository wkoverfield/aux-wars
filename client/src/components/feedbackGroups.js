const STATUS_ORDER = { planned: 0, pending: 1 };

/**
 * Splits the board into open requests (planned first, then pending; the
 * server's upvote/newest order is kept within each status), shipped items,
 * and declined ones.
 */
export function groupFeedback(feedback) {
  const items = feedback ?? [];
  const open = items
    .filter((item) => item.status === 'planned' || item.status === 'pending')
    .map((item, index) => ({ item, index }))
    .sort((a, b) => STATUS_ORDER[a.item.status] - STATUS_ORDER[b.item.status] || a.index - b.index)
    .map(({ item }) => item);
  return {
    open,
    shipped: items.filter((item) => item.status === 'completed'),
    declined: items.filter((item) => item.status === 'declined'),
  };
}
