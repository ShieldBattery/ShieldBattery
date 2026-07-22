/**
 * Returns a copy of `ids` with `id` moved to `toIndex` (clamped to the valid index range for the
 * resulting array). Returns a copy of `ids` unchanged if `id` isn't present.
 */
export function reorderPlaylistEntries(
  ids: readonly number[],
  id: number,
  toIndex: number,
): number[] {
  const fromIndex = ids.indexOf(id)
  if (fromIndex === -1) {
    return ids.slice()
  }

  const result = ids.slice()
  result.splice(fromIndex, 1)
  const clampedIndex = Math.max(0, Math.min(toIndex, result.length))
  result.splice(clampedIndex, 0, id)
  return result
}
