import { describe, expect, test } from 'vitest'
import { MapForce, MapForcePlayer } from '../../common/maps'
import { MapKind } from '../gql/graphql'
import {
  canPlayFileAlone,
  getComputerSummary,
  getPlayAloneSlots,
  playAloneLeads,
  resolvePlayAloneSlot,
  slotFixedRace,
} from './play-alone-model'

function human(id: number, race: MapForcePlayer['race'] = 'any'): MapForcePlayer {
  return { id, race, typeId: 6, computer: false }
}

function computer(id: number, typeId = 5): MapForcePlayer {
  return { id, race: 'z', typeId, computer: true }
}

const FORCES: MapForce[] = [
  { name: 'Waves', teamId: 1, players: [computer(0), computer(1), computer(2, 7)] },
  { name: 'Defenders', teamId: 2, players: [human(3), human(4, 't')] },
  { name: 'Allies', teamId: 3, players: [computer(5), human(6, 'p')] },
  { name: 'Neutral', teamId: 4, players: [computer(7, 3)] },
]

describe('getPlayAloneSlots', () => {
  test('lists the human slots in force order', () => {
    expect(getPlayAloneSlots(FORCES)).toEqual([
      { id: 3, forceIndex: 1, forceName: 'Defenders', indexInForce: 0, race: 'any' },
      { id: 4, forceIndex: 1, forceName: 'Defenders', indexInForce: 1, race: 't' },
      { id: 6, forceIndex: 2, forceName: 'Allies', indexInForce: 0, race: 'p' },
    ])
  })

  test('is empty for a map without human slots', () => {
    expect(getPlayAloneSlots([FORCES[0]])).toEqual([])
  })
})

describe('resolvePlayAloneSlot', () => {
  const slots = getPlayAloneSlots(FORCES)

  test('defaults to the first human slot', () => {
    expect(resolvePlayAloneSlot(slots, undefined)?.id).toBe(3)
  })

  test('keeps a picked slot', () => {
    expect(resolvePlayAloneSlot(slots, 6)?.id).toBe(6)
  })

  test('falls back to the first slot when the picked one is gone', () => {
    expect(resolvePlayAloneSlot(slots, 0)?.id).toBe(3)
  })

  test('has nothing to resolve to without slots', () => {
    expect(resolvePlayAloneSlot([], undefined)).toBeUndefined()
  })
})

describe('slotFixedRace', () => {
  const [free, terran] = getPlayAloneSlots(FORCES)

  test('leaves a free slot without a race', () => {
    expect(slotFixedRace(free)).toBeUndefined()
  })

  test("gives a fixed slot the map's race", () => {
    expect(slotFixedRace(terran)).toBe('t')
  })
})

describe('getComputerSummary', () => {
  test('counts the regular computers of each force that has any, leaving hidden slots out', () => {
    expect(getComputerSummary(FORCES)).toEqual([
      { forceIndex: 0, forceName: 'Waves', computers: 2 },
      { forceIndex: 2, forceName: 'Allies', computers: 1 },
    ])
  })
})

function gqlForces(forces: ReadonlyArray<MapForce>) {
  return forces.map(force => ({
    players: force.players.map(p => ({ isComputer: p.computer, typeId: p.typeId })),
  }))
}

describe('canPlayFileAlone', () => {
  test('takes a UMS map with a human slot and a computer', () => {
    expect(canPlayFileAlone(MapKind.Ums, gqlForces(FORCES))).toBe(true)
  })

  test('refuses a melee map', () => {
    expect(canPlayFileAlone(MapKind.Melee, gqlForces(FORCES))).toBe(false)
  })

  test('refuses a map whose only computers are hidden', () => {
    const forces: MapForce[] = [
      { name: 'Players', teamId: 1, players: [human(0)] },
      { name: 'Neutral', teamId: 2, players: [computer(1, 7)] },
    ]
    expect(canPlayFileAlone(MapKind.Ums, gqlForces(forces))).toBe(false)
  })

  test('refuses a map without a human slot', () => {
    expect(canPlayFileAlone(MapKind.Ums, gqlForces([FORCES[0]]))).toBe(false)
  })
})

describe('playAloneLeads', () => {
  test('leads on a map with a single human slot', () => {
    const forces: MapForce[] = [
      { name: 'Hero', teamId: 1, players: [human(0)] },
      { name: 'Enemies', teamId: 2, players: [computer(1), computer(2)] },
    ]
    expect(playAloneLeads(gqlForces(forces))).toBe(true)
  })

  test('follows hosting on a map with several human slots', () => {
    expect(playAloneLeads(gqlForces(FORCES))).toBe(false)
  })
})
