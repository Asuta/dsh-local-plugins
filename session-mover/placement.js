/** Pure ordering rules. Pin membership is authoritative and never changed here. */
export function placementBefore(ids, pinnedIds, sessionId, position) {
  const pins = new Set(pinnedIds)
  const without = ids.filter(id => id !== sessionId)
  const partition = without.filter(id => pins.has(id) === pins.has(sessionId))
  if (position?.edge === 'end') return undefined
  const anchor = position?.anchorSessionId
  if (anchor !== undefined) {
    if (!without.includes(anchor)) throw Object.assign(new Error('The target conversation moved or disappeared; drop again'), { code: 'STALE_POSITION' })
    if (!['before', 'after'].includes(position.edge)) throw Object.assign(new Error('Position edge must be before or after'), { code: 'BAD_REQUEST' })
    if (pins.has(anchor) === pins.has(sessionId)) {
      const index = partition.indexOf(anchor)
      return position.edge === 'before' ? anchor : partition[index + 1]
    }
  }
  // Workspace header or opposite partition: first in the moving item's own partition.
  return partition[0]
}

/** Preserve the raw ownership order, not just the currently visible/truncated rows. */
export function captureOrder(ids, sessionId) {
  const index = ids.indexOf(sessionId)
  if (index < 0) throw Object.assign(new Error('The source conversation is no longer accounted'), { code: 'STALE_SOURCE' })
  return { index, before: ids.slice(index + 1), after: ids.slice(0, index).reverse() }
}

export function restoreBefore(ids, sessionId, order) {
  const without = ids.filter(id => id !== sessionId)
  const next = order.before.find(id => without.includes(id))
  if (next !== undefined) return next
  const previous = order.after.find(id => without.includes(id))
  if (previous !== undefined) return without[without.indexOf(previous) + 1]
  return without[Math.min(order.index, without.length)]
}
