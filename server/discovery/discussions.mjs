const MAX_LINK_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// A search index's empty response is not an authoritative deletion signal.
// Keep link-only observations briefly, with their original dates and a stale label.
export function retainEarlierDiscussionLinks(items, destinationId, now = Date.now()) {
  return items.filter(item => {
    if (item.destinationId !== destinationId) return true;
    const age = now - Date.parse(item.retrievedAt);
    return Number.isFinite(age) && age >= 0 && age < MAX_LINK_AGE_MS;
  }).map(item => item.destinationId === destinationId ? { ...item, stale: true } : item);
}
