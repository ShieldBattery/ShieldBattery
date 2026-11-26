import { TFunction } from 'i18next'
import { describe, expect, test } from 'vitest'
import { makeSbMapId } from '../../common/maps'
import { MapPoolChangeNotice } from '../../common/matchmaking/matchmaking-map-pools'
import {
  getMapPoolChangeBadgeText,
  getMapPoolChangeParts,
  getMapPoolChangeSummaryText,
  groupDroppedSelections,
  orderMapsFirst,
} from './map-pool-change-text'

const m = makeSbMapId

/** Renders a translation call as its default value, picking the singular form for a count of 1. */
const t = ((_key: string, options: string | Record<string, any>) => {
  if (typeof options === 'string') {
    return options
  }
  const template: string =
    options.count === 1 && options.defaultValue_one
      ? options.defaultValue_one
      : options.defaultValue
  return template.replace(/{{(\w+)}}/g, (_match, name) => String(options[name]))
}) as unknown as TFunction

function notice(overrides: Partial<MapPoolChangeNotice> = {}): MapPoolChangeNotice {
  return { addedMaps: [], removedMaps: [], droppedSelections: [], ...overrides }
}

describe('client/matchmaking/map-pool-change-text', () => {
  test('lists only the kinds of change that happened, in order', () => {
    expect(
      getMapPoolChangeParts(
        notice({
          addedMaps: [m('a'), m('b')],
          maxVetoCount: { previous: 3, current: 2 },
          mapCount: { previous: 4, current: 6 },
        }),
      ),
    ).toEqual([
      { kind: 'added', count: 2 },
      { kind: 'vetoLimit', previous: 3, current: 2 },
    ])
    expect(getMapPoolChangeParts(notice({ removedMaps: [m('a')] }))).toEqual([
      { kind: 'removed', count: 1 },
    ])
  })

  test('joins the summary segments', () => {
    expect(
      getMapPoolChangeSummaryText(
        notice({
          addedMaps: [m('a'), m('b')],
          removedMaps: [m('c')],
          maxVetoCount: { previous: 3, current: 2 },
        }),
        t,
      ),
    ).toBe('2 new maps · 1 removed · Vetoes 3 → 2')
    expect(getMapPoolChangeSummaryText(notice({ addedMaps: [m('a')] }), t)).toBe('1 new map')
  })

  test('the badge shows the first segment, or a generic label for dropped selections only', () => {
    expect(
      getMapPoolChangeBadgeText(
        notice({ removedMaps: [m('c')], maxVetoCount: { previous: 3, current: 2 } }),
        t,
      ),
    ).toBe('1 removed')
    expect(
      getMapPoolChangeBadgeText(notice({ maxVetoCount: { previous: 3, current: 2 } }), t),
    ).toBe('Vetoes 3 → 2')
    expect(
      getMapPoolChangeBadgeText(
        notice({ droppedSelections: [{ mapId: m('a'), reason: 'mapRemoved' }] }),
        t,
      ),
    ).toBe('Updated')
  })

  test('groups dropped selections by reason', () => {
    expect(
      groupDroppedSelections(
        notice({
          droppedSelections: [
            { mapId: m('a'), reason: 'vetoLimit' },
            { mapId: m('b'), reason: 'mapRemoved' },
            { mapId: m('c'), reason: 'vetoLimit' },
          ],
        }),
      ),
    ).toEqual([
      { reason: 'mapRemoved', mapIds: [m('b')] },
      { reason: 'vetoLimit', mapIds: [m('a'), m('c')] },
    ])
    expect(groupDroppedSelections(notice())).toEqual([])
  })

  test('moves the given maps first, keeping the pool order otherwise', () => {
    const maps = [m('a'), m('b'), m('c'), m('d')]
    expect(orderMapsFirst(maps, [m('d'), m('b')])).toEqual([m('b'), m('d'), m('a'), m('c')])
    expect(orderMapsFirst(maps, undefined)).toEqual(maps)
  })
})
