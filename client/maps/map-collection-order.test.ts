import { TFunction } from 'i18next'
import { describe, expect, test } from 'vitest'
import { moveTargetIndex, removedMapText, rowIndex } from './map-collection-order'

/** Returns each string's default text with its `{{placeholders}}` filled in. */
const t = ((_key: string, options: Record<string, unknown>) =>
  String(options.defaultValue).replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
    String(options[name] ?? ''),
  )) as unknown as TFunction

describe('client/maps/map-collection-order', () => {
  test('moves a map one step toward either end', () => {
    expect(moveTargetIndex(3, -1, 10)).toBe(2)
    expect(moveTargetIndex(3, 1, 10)).toBe(4)
  })

  test("doesn't move the first map up or the last map down", () => {
    expect(moveTargetIndex(0, -1, 10)).toBeUndefined()
    expect(moveTargetIndex(9, 1, 10)).toBeUndefined()
    expect(moveTargetIndex(0, 1, 10)).toBe(1)
    expect(moveTargetIndex(9, -1, 10)).toBe(8)
  })

  test("doesn't move the only map", () => {
    expect(moveTargetIndex(0, -1, 1)).toBeUndefined()
    expect(moveTargetIndex(0, 1, 1)).toBeUndefined()
  })

  test("doesn't move a map from outside the collection", () => {
    expect(moveTargetIndex(-1, 1, 10)).toBeUndefined()
    expect(moveTargetIndex(10, -1, 10)).toBeUndefined()
    expect(moveTargetIndex(1.5, 1, 10)).toBeUndefined()
    expect(moveTargetIndex(0, 1, 0)).toBeUndefined()
  })

  test('moves across the boundary between pages of rows', () => {
    const lastOfFirstPage = rowIndex(0, 39, 40)
    const firstOfSecondPage = rowIndex(1, 0, 40)
    expect(lastOfFirstPage).toBe(39)
    expect(firstOfSecondPage).toBe(40)
    expect(moveTargetIndex(lastOfFirstPage, 1, 41)).toBe(firstOfSecondPage)
    expect(moveTargetIndex(firstOfSecondPage, -1, 41)).toBe(lastOfFirstPage)
  })

  test('numbers rows across pages', () => {
    expect(rowIndex(0, 0, 40)).toBe(0)
    expect(rowIndex(2, 5, 40)).toBe(85)
  })

  test('names the map and collection a map was removed from', () => {
    expect(removedMapText('Fighting Spirit', 'My collection', t)).toBe(
      'Removed Fighting Spirit from My collection',
    )
  })
})
