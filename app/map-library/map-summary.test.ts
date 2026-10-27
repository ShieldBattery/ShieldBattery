import type { MapSummary } from '@shieldbattery/broodmap'
import { describe, expect, test } from 'vitest'
import { LocalMapKind } from '../../common/map-library'
import { filterColorCodes, normalizeSearch, sortName, toLocalMapInfo } from './map-summary'

const HUMAN = 6
const COMPUTER = 5
const INACTIVE = 0
const ANY_RACE = 5

function summary(overrides: Partial<MapSummary> = {}): MapSummary {
  return {
    name: '(2)Test',
    description: null,
    width: 128,
    height: 96,
    tileset: 4,
    stringEncoding: 'utf8',
    players: [
      { controller: HUMAN, race: ANY_RACE, force: 0 },
      { controller: HUMAN, race: ANY_RACE, force: 0 },
      ...Array.from({ length: 6 }, () => ({ controller: INACTIVE, race: ANY_RACE, force: 0 })),
    ],
    forces: Array.from({ length: 4 }, () => ({ name: null })),
    usesEud: false,
    triggerActionKinds: ['Defeat', 'ModifyResources', 'NoAction', 'Victory'],
    triggerCount: 4,
    placedUnits: 30,
    playerUnits: 0,
    startLocations: 2,
    ...overrides,
  }
}

describe('app/map-library/map-summary/toLocalMapInfo', () => {
  test('a map with melee triggers and two human slots is melee', () => {
    expect(toLocalMapInfo(summary())).toEqual({
      name: '(2)Test',
      width: 128,
      height: 96,
      tileset: 4,
      kind: LocalMapKind.Melee,
      playerCount: 2,
      isEud: false,
    })
  })

  test('melee variants built on removing units and death counts stay melee', () => {
    const info = toLocalMapInfo(
      summary({ triggerActionKinds: ['RemoveUnitAtLocation', 'SetDeaths', 'Victory', 'Wait'] }),
    )
    expect(info.kind).toBe(LocalMapKind.Melee)
  })

  test('any other trigger action makes a map UMS', () => {
    const info = toLocalMapInfo(summary({ triggerActionKinds: ['CreateUnit', 'Victory'] }))
    expect(info.kind).toBe(LocalMapKind.Ums)
  })

  test('EUDs make a map UMS', () => {
    const info = toLocalMapInfo(summary({ usesEud: true }))
    expect(info).toMatchObject({ kind: LocalMapKind.Ums, isEud: true })
  })

  test('more than 8 preplaced player units make a map UMS', () => {
    expect(toLocalMapInfo(summary({ playerUnits: 8 })).kind).toBe(LocalMapKind.Melee)
    expect(toLocalMapInfo(summary({ playerUnits: 9 })).kind).toBe(LocalMapKind.Ums)
  })

  test('a map that can not seat two players in melee is UMS', () => {
    const players = summary().players.map((p, i) => (i === 1 ? { ...p, controller: 0 } : p))
    expect(toLocalMapInfo(summary({ players })).kind).toBe(LocalMapKind.Ums)
  })

  test('UMS maps count the human slots in a force, melee maps every active slot', () => {
    const players = [
      { controller: HUMAN, race: ANY_RACE, force: 0 },
      { controller: HUMAN, race: ANY_RACE, force: 1 },
      { controller: HUMAN, race: ANY_RACE, force: 4 },
      { controller: COMPUTER, race: 1, force: 2 },
      ...Array.from({ length: 4 }, () => ({ controller: INACTIVE, race: ANY_RACE, force: 0 })),
    ]
    expect(toLocalMapInfo(summary({ players })).playerCount).toBe(4)
    expect(
      toLocalMapInfo(summary({ players, triggerActionKinds: ['CreateUnit'] })).playerCount,
    ).toBe(2)
  })

  test('names lose their color codes, and a missing name is empty', () => {
    expect(toLocalMapInfo(summary({ name: '\u0003Fighting \u0004Spirit' })).name).toBe(
      'Fighting Spirit',
    )
    expect(toLocalMapInfo(summary({ name: null })).name).toBe('')
  })
})

describe('app/map-library/map-summary/filterColorCodes', () => {
  test('keeps line breaks', () => {
    expect(filterColorCodes('a\u0001b\nc\r\td')).toBe('ab\nc\rd')
  })
})

describe('app/map-library/map-summary/normalizeSearch', () => {
  test('matches the server: lowercase, punctuation runs to one space, trimmed', () => {
    expect(normalizeSearch('(4)Lights Out1.6e')).toBe('4 lights out1 6e')
    expect(normalizeSearch('  --Fighting  Spirit--  ')).toBe('fighting spirit')
    expect(normalizeSearch('[EUD]왕의기사')).toBe('eud 왕의기사')
    expect(normalizeSearch('100%_\\done')).toBe('100 done')
    expect(normalizeSearch('大陸')).toBe('大陸')
  })
})

describe('app/map-library/map-summary/sortName', () => {
  test('drops leading prefixes, tags and punctuation', () => {
    expect(sortName('(4)Lights Out')).toBe('Lights Out')
    expect(sortName('[EUD] (2)Bound')).toBe('Bound')
    expect(sortName('  ~Cat')).toBe('Cat')
    expect(sortName('Python')).toBe('Python')
  })

  test('falls back to the whole name when nothing would be left', () => {
    expect(sortName('(4)')).toBe('(4)')
  })
})
