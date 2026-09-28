import { describe, expect, test } from 'vitest'
import {
  collapseSelection,
  findNeighborOutside,
  getSelectedIds,
  LibrarySelection,
  selectOnly,
  selectRangeTo,
  toggleInSelection,
} from './replay-library-selection'

const IDS = [10, 11, 12, 13, 14, 15]

function selected(selection: LibrarySelection) {
  return getSelectedIds(selection, IDS, selection.focusedId)
}

describe('client/replays/replay-library-selection', () => {
  test('a single selection is just the focused row', () => {
    const selection = selectOnly(12)
    expect(selected(selection)).toEqual([12])
    expect(selection.multi).toBeUndefined()
  })

  test('with no stored focus, the fallback focused row is the selection', () => {
    expect(getSelectedIds(selectOnly(undefined), IDS, 10)).toEqual([10])
  })

  test('Ctrl-click adds rows and focuses the clicked one', () => {
    let selection = selectOnly(10)
    selection = toggleInSelection(selection, IDS, selection.focusedId, 12)
    selection = toggleInSelection(selection, IDS, selection.focusedId, 14)
    expect(selected(selection)).toEqual([10, 12, 14])
    expect(selection.focusedId).toBe(14)
    expect(selection.anchorId).toBe(14)
  })

  test('Ctrl-click on a selected row removes it and keeps focus on a selected row', () => {
    let selection = selectOnly(10)
    selection = toggleInSelection(selection, IDS, selection.focusedId, 12)
    selection = toggleInSelection(selection, IDS, selection.focusedId, 14)
    selection = toggleInSelection(selection, IDS, selection.focusedId, 14)
    expect(selected(selection)).toEqual([10, 12])
    expect(selection.focusedId).toBe(12)
  })

  test('toggling down to one row collapses to a single selection', () => {
    let selection = selectOnly(10)
    selection = toggleInSelection(selection, IDS, selection.focusedId, 12)
    selection = toggleInSelection(selection, IDS, selection.focusedId, 10)
    expect(selection).toEqual({ focusedId: 12, anchorId: 10, multi: undefined })
  })

  test('the only selected row cannot be toggled out', () => {
    const selection = toggleInSelection(selectOnly(11), IDS, 11, 11)
    expect(selected(selection)).toEqual([11])
  })

  test('Shift-click selects from the anchor to the clicked row, replacing the selection', () => {
    let selection = selectOnly(10)
    selection = toggleInSelection(selection, IDS, selection.focusedId, 11)
    selection = toggleInSelection(selection, IDS, selection.focusedId, 12)
    selection = selectRangeTo(selection, IDS, selection.focusedId, 14)
    expect(selected(selection)).toEqual([12, 13, 14])
    expect(selection.focusedId).toBe(14)
    expect(selection.anchorId).toBe(12)
  })

  test('Ctrl+Shift-click adds the range to the existing selection', () => {
    let selection = selectOnly(10)
    selection = toggleInSelection(selection, IDS, selection.focusedId, 12)
    selection = selectRangeTo(selection, IDS, selection.focusedId, 14, true)
    expect(selected(selection)).toEqual([10, 12, 13, 14])
  })

  test('repeated Shift ranges pivot on the same anchor', () => {
    let selection = selectOnly(12)
    selection = selectRangeTo(selection, IDS, selection.focusedId, 13)
    selection = selectRangeTo(selection, IDS, selection.focusedId, 14)
    expect(selected(selection)).toEqual([12, 13, 14])
    selection = selectRangeTo(selection, IDS, selection.focusedId, 11)
    expect(selected(selection)).toEqual([11, 12])
  })

  test('a Shift range back onto the anchor collapses to a single selection', () => {
    let selection = selectOnly(12)
    selection = selectRangeTo(selection, IDS, selection.focusedId, 13)
    selection = selectRangeTo(selection, IDS, selection.focusedId, 12)
    expect(selection.multi).toBeUndefined()
    expect(selected(selection)).toEqual([12])
  })

  test('a Shift range anchors on the fallback focused row when nothing is stored', () => {
    const selection = selectRangeTo(selectOnly(undefined), IDS, 10, 12)
    expect(selected(selection)).toEqual([10, 11, 12])
  })

  test('selected rows that are no longer loaded drop out', () => {
    let selection = selectOnly(10)
    selection = selectRangeTo(selection, IDS, selection.focusedId, 12)
    expect(getSelectedIds(selection, [12, 13], 12)).toEqual([12])
  })

  test('collapsing keeps the focused row', () => {
    let selection = selectOnly(10)
    selection = selectRangeTo(selection, IDS, selection.focusedId, 12)
    expect(collapseSelection(selection)).toEqual(selectOnly(12))
  })

  test('the neighbor after removed rows is the next unremoved row', () => {
    expect(findNeighborOutside(IDS, new Set([11, 13]))).toBe(14)
    expect(findNeighborOutside(IDS, new Set([14, 15]))).toBe(13)
    expect(findNeighborOutside(IDS, new Set(IDS))).toBeUndefined()
    expect(findNeighborOutside(IDS, new Set([99]))).toBeUndefined()
  })
})
