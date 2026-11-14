import { describe, expect, test, vi } from 'vitest'
import { makeSbMapId } from '../../common/maps'
import { MapPickOptions, tilePick } from './map-catalog-list'

const MAP = makeSbMapId('map')
const OTHER_MAP = makeSbMapId('other')
const FAMILY = 'family'

function options(changes: Partial<MapPickOptions> = {}): MapPickOptions {
  return {
    onPick: vi.fn(() => Promise.resolve(true)),
    isMarked: () => true,
    markedLabel: 'In this collection',
    ...changes,
  }
}

describe('maps/map-catalog-list/tilePick', () => {
  test("can't pick a marked tile without onPickMarked", () => {
    const pick = tilePick(options(), MAP, FAMILY)
    expect(pick.disabled).toBe(true)
    expect(pick.selected).toBe(false)
    expect(pick.markedLabel).toBe('In this collection')
  })

  test('picks a marked tile with onPickMarked, showing it as selected', () => {
    const onPickMarked = vi.fn(() => Promise.resolve(true))
    const pickOptions = options({ onPickMarked })
    const pick = tilePick(pickOptions, MAP, FAMILY)
    expect(pick.disabled).toBe(false)
    expect(pick.selected).toBe(true)
    expect(pick.markedLabel).toBe('In this collection')

    pick.onPick('Fighting Spirit')
    expect(onPickMarked).toHaveBeenCalledWith(MAP, FAMILY, 'Fighting Spirit')
    expect(pickOptions.onPick).not.toHaveBeenCalled()
  })

  test('picks an unmarked tile with onPick, even when onPickMarked is set', () => {
    const onPickMarked = vi.fn(() => Promise.resolve(true))
    const pickOptions = options({ isMarked: () => false, onPickMarked })
    const pick = tilePick(pickOptions, MAP, FAMILY)
    expect(pick.disabled).toBe(false)
    expect(pick.selected).toBe(false)
    expect(pick.markedLabel).toBeUndefined()

    pick.onPick('Fighting Spirit')
    expect(pickOptions.onPick).toHaveBeenCalledWith(MAP, FAMILY)
    expect(onPickMarked).not.toHaveBeenCalled()
  })

  test('keeps marked tiles pickable with onPickMarked when no more maps can be picked', () => {
    const onPickMarked = () => Promise.resolve(true)
    expect(tilePick(options({ disabled: true, onPickMarked }), MAP, FAMILY).disabled).toBe(false)
    expect(
      tilePick(options({ disabled: true, onPickMarked, isMarked: () => false }), MAP, FAMILY)
        .disabled,
    ).toBe(true)
  })

  test('disables every other tile while a pick is pending', () => {
    const onPickMarked = () => Promise.resolve(true)
    const pickOptions = options({ onPickMarked, pendingMapId: OTHER_MAP })
    expect(tilePick(pickOptions, MAP, FAMILY).disabled).toBe(true)

    const pending = tilePick(pickOptions, OTHER_MAP, FAMILY)
    expect(pending.disabled).toBe(false)
    expect(pending.pending).toBe(true)
  })
})
