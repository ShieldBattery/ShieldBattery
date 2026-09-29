/**
 * The replay library's row selection. The common case is a single focused row; a multi-selection
 * is built with Ctrl-click (toggle), Shift-click (range) and Shift+Up/Down (extend).
 */
export interface LibrarySelection {
  /** The row keyboard navigation, Enter and the inspector act on. */
  focusedId: number | undefined
  /**
   * The fixed end of a Shift range, whose other end is the clicked (or newly focused) row. Falls
   * back to the focused row when unset or no longer loaded.
   */
  anchorId: number | undefined
  /**
   * Every selected row while more than one is selected. `undefined` means the selection is just
   * the focused row.
   */
  multi: ReadonlySet<number> | undefined
}

export function selectOnly(id: number | undefined): LibrarySelection {
  return { focusedId: id, anchorId: id, multi: undefined }
}

/** Drops the multi-selection, keeping the focused row (and so the inspector) where it is. */
export function collapseSelection(selection: LibrarySelection): LibrarySelection {
  return selection.multi ? selectOnly(selection.focusedId) : selection
}

/**
 * The selected ids, in list order, as the rows currently loaded see them. `focusedId` is the row
 * the library actually treats as focused (which falls back to the first row when the stored one
 * isn't loaded).
 */
export function getSelectedIds(
  selection: LibrarySelection,
  orderedIds: ReadonlyArray<number>,
  focusedId: number | undefined,
): number[] {
  if (selection.multi) {
    const multi = selection.multi
    const selected = orderedIds.filter(id => multi.has(id))
    if (selected.length > 1) {
      return selected
    }
  }
  return focusedId !== undefined ? [focusedId] : []
}

function fromSelectedSet(
  selected: ReadonlySet<number>,
  focusedId: number,
  anchorId: number | undefined,
): LibrarySelection {
  if (selected.size <= 1) {
    const only = selected.size === 1 ? [...selected][0] : focusedId
    return { focusedId: only, anchorId: anchorId ?? only, multi: undefined }
  }
  return { focusedId, anchorId, multi: selected }
}

/**
 * Ctrl-click: toggles `id` in or out of the selection and makes it the new range anchor. The last
 * selected row can't be toggled out, since the library always has a focused row.
 */
export function toggleInSelection(
  selection: LibrarySelection,
  orderedIds: ReadonlyArray<number>,
  focusedId: number | undefined,
  id: number,
): LibrarySelection {
  const current = new Set(getSelectedIds(selection, orderedIds, focusedId))
  if (!current.has(id)) {
    current.add(id)
    return fromSelectedSet(current, id, id)
  }
  if (current.size <= 1) {
    return selectOnly(id)
  }

  current.delete(id)
  // Focus stays on a selected row, so Enter and the inspector never act on a row that isn't
  // highlighted. The nearest remaining row below the toggled one wins, then the nearest above.
  const index = orderedIds.indexOf(id)
  const below = orderedIds.slice(index + 1).find(other => current.has(other))
  const above = orderedIds
    .slice(0, Math.max(index, 0))
    .reverse()
    .find(other => current.has(other))
  const nextFocus = focusedId === id || focusedId === undefined ? (below ?? above!) : focusedId
  return fromSelectedSet(current, nextFocus, id)
}

/**
 * Shift-click (or Shift+Up/Down): selects the rows from the anchor to `id` inclusive, moving focus
 * to `id` and leaving the anchor where it was. With `additive` (Ctrl+Shift-click) the range is
 * added to the existing selection instead of replacing it.
 */
export function selectRangeTo(
  selection: LibrarySelection,
  orderedIds: ReadonlyArray<number>,
  focusedId: number | undefined,
  id: number,
  additive = false,
): LibrarySelection {
  const toIndex = orderedIds.indexOf(id)
  if (toIndex < 0) {
    return selection
  }
  const anchorId =
    selection.anchorId !== undefined && orderedIds.includes(selection.anchorId)
      ? selection.anchorId
      : focusedId
  const anchorIndex = anchorId !== undefined ? orderedIds.indexOf(anchorId) : -1
  if (anchorIndex < 0) {
    return selectOnly(id)
  }

  const start = Math.min(anchorIndex, toIndex)
  const end = Math.max(anchorIndex, toIndex)
  const range = orderedIds.slice(start, end + 1)
  const selected = new Set(
    additive ? [...getSelectedIds(selection, orderedIds, focusedId), ...range] : range,
  )
  return fromSelectedSet(selected, id, anchorId)
}

/**
 * The row that should take focus once every row in `removedIds` leaves the list: the first row
 * after the last removed one, or else the last row before the first removed one.
 */
export function findNeighborOutside(
  orderedIds: ReadonlyArray<number>,
  removedIds: ReadonlySet<number>,
): number | undefined {
  let lastRemoved = -1
  let firstRemoved = -1
  orderedIds.forEach((id, index) => {
    if (removedIds.has(id)) {
      if (firstRemoved < 0) firstRemoved = index
      lastRemoved = index
    }
  })
  if (lastRemoved < 0) {
    return undefined
  }
  const after = orderedIds.slice(lastRemoved + 1).find(id => !removedIds.has(id))
  if (after !== undefined) {
    return after
  }
  return orderedIds
    .slice(0, firstRemoved)
    .reverse()
    .find(id => !removedIds.has(id))
}
