import { describe, expect, test } from 'vitest'
import { PlayerInfo } from '../../../common/games/game-launch-config'
import { GameType } from '../../../common/games/game-type'
import { getLobbySlotsWithIndexes, getPlayerInfos, hasOpposingSides } from '../../../common/lobbies'
import { SlotType } from '../../../common/lobbies/slot'
import { makeSbMapId, MapForce, MapInfo, MapVisibility, Tileset } from '../../../common/maps'
import { RaceChar } from '../../../common/races'
import { canPlayMapAlone, SoloGameServiceErrorCode } from '../../../common/solo-games'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import * as Lobbies from '../lobbies/lobby'
import { SoloGameServiceError } from './solo-game-service-error'
import { buildSoloGameSlots } from './solo-game-slots'

const USER = makeSbUserId(7)
const COMPUTER_ID = makeSbUserId(0)

function umsMap(name: string, umsForces: MapForce[]): MapInfo {
  const slots = umsForces.reduce((count, force) => count + force.players.length, 0)
  return {
    id: makeSbMapId(name),
    hash: name,
    name,
    description: '',
    kind: 'ums',
    visibility: MapVisibility.Public,
    mapData: {
      format: 'scx',
      tileset: Tileset.Jungle,
      originalName: name,
      originalDescription: '',
      slots,
      umsSlots: slots,
      umsForces,
      width: 128,
      height: 128,
      isEud: false,
      startLocations: [],
      parserVersion: 1,
    },
    imageVersion: 1,
    imageSpawnsBaked: true,
  }
}

/** Every human slot plays against computers that have a force of their own. */
const COMPUTERS_OWN_FORCE = umsMap('computers-own-force', [
  {
    name: 'Players',
    teamId: 1,
    players: [
      { id: 0, race: 'any', typeId: 6, computer: false },
      { id: 1, race: 'any', typeId: 6, computer: false },
    ],
  },
  {
    name: 'Enemies',
    teamId: 2,
    players: [
      { id: 2, race: 'z', typeId: 5, computer: true },
      { id: 3, race: 't', typeId: 5, computer: true },
    ],
  },
])

/** Humans and computers share both forces, and one human slot has a fixed race. */
const MIXED_FORCES = umsMap('mixed-forces', [
  {
    name: 'North',
    teamId: 1,
    players: [
      { id: 0, race: 't', typeId: 6, computer: false },
      { id: 1, race: 'p', typeId: 5, computer: true },
    ],
  },
  {
    name: 'South',
    teamId: 2,
    players: [
      { id: 2, race: 'any', typeId: 6, computer: false },
      { id: 3, race: 'z', typeId: 5, computer: true },
    ],
  },
])

/**
 * Computers a lobby doesn't show (a rescuable and a neutral one), placed between visible slots so
 * the order slots are sent in shows.
 */
const HIDDEN_SLOTS = umsMap('hidden-slots', [
  {
    name: 'Hero',
    teamId: 1,
    players: [
      { id: 0, race: 'any', typeId: 6, computer: false },
      { id: 1, race: 't', typeId: 3, computer: true },
    ],
  },
  {
    name: 'World',
    teamId: 2,
    players: [
      { id: 2, race: 'z', typeId: 7, computer: true },
      { id: 3, race: 'z', typeId: 5, computer: true },
      { id: 4, race: 'any', typeId: 6, computer: false },
    ],
  },
])

/** Several human slots in several forces, with fixed and free races. */
const SEVERAL_HUMANS = umsMap('several-humans', [
  {
    name: 'Team I',
    teamId: 1,
    players: [
      { id: 0, race: 't', typeId: 6, computer: false },
      { id: 1, race: 'z', typeId: 6, computer: false },
      { id: 2, race: 'any', typeId: 6, computer: false },
    ],
  },
  {
    name: 'Map',
    teamId: 3,
    players: [{ id: 3, race: 'p', typeId: 5, computer: true }],
  },
  {
    name: 'Team II',
    teamId: 2,
    players: [
      { id: 4, race: 'any', typeId: 6, computer: false },
      { id: 5, race: 'any', typeId: 6, computer: false },
    ],
  },
])

const FIXTURES = [COMPUTERS_OWN_FORCE, MIXED_FORCES, HIDDEN_SLOTS, SEVERAL_HUMANS]

/**
 * The `PlayerInfo`s a Use Map Settings lobby on `map` sends to the game when only its host is in
 * it, seated in the map slot `slot` (or wherever a new lobby seats them) and playing `race`.
 */
function lobbyPlayerInfos(map: MapInfo, slot?: number, race?: RaceChar): PlayerInfo[] {
  let lobby = Lobbies.createLobby({
    name: 'Solo',
    map,
    gameType: GameType.UseMapSettings,
    numSlots: map.mapData.slots,
    hostUserId: USER,
    allowObservers: false,
  })
  if (slot !== undefined) {
    const [[fromTeam, fromSlot]] = getLobbySlotsWithIndexes(lobby).filter(
      ([, , s]) => s.userId === USER,
    )
    const [[toTeam, toSlot, target]] = getLobbySlotsWithIndexes(lobby).filter(
      ([, , s]) => s.playerId === slot,
    )
    if (target.type === SlotType.Open) {
      lobby = Lobbies.movePlayerToSlot(lobby, fromTeam, fromSlot, toTeam, toSlot)
    }
  }
  if (race !== undefined) {
    const [[teamIndex, slotIndex]] = getLobbySlotsWithIndexes(lobby).filter(
      ([, , s]) => s.userId === USER,
    )
    lobby = Lobbies.setRace(lobby, teamIndex, slotIndex, race)
  }
  return getPlayerInfos(lobby)
}

/** Drops the generated slot ids, which differ between any two builds of the same slots. */
function withoutIds(infos: PlayerInfo[]): Array<Omit<PlayerInfo, 'id'>> {
  return infos.map(({ id: _id, ...rest }) => rest)
}

function expectRefusal(fn: () => unknown, code: SoloGameServiceErrorCode) {
  let error: unknown
  try {
    fn()
  } catch (err) {
    error = err
  }
  expect(error).toBeInstanceOf(SoloGameServiceError)
  expect(error).toMatchObject({ code })
}

describe('solo-games/solo-game-slots/buildSoloGameSlots', () => {
  describe('matches a lobby with only its host', () => {
    test.each(FIXTURES.map(map => [map.name, map] as const))(
      '%s, in the default slot',
      (_name, map) => {
        const { playerInfos } = buildSoloGameSlots({ map, userId: USER })
        expect(withoutIds(playerInfos)).toEqual(withoutIds(lobbyPlayerInfos(map)))
      },
    )

    const seatings = FIXTURES.flatMap(map =>
      map.mapData.umsForces
        .flatMap(force => force.players)
        .filter(p => !p.computer)
        .flatMap(p =>
          (p.race === 'any' ? (['p', 't', 'z', 'r'] as const) : [p.race]).map(
            race => [map.name, p.id, race, map] as const,
          ),
        ),
    )
    test.each(seatings)('%s, in slot %i as %s', (_name, slot, race, map) => {
      const { playerInfos } = buildSoloGameSlots({ map, userId: USER, slot, race })
      expect(withoutIds(playerInfos)).toEqual(withoutIds(lobbyPlayerInfos(map, slot, race)))
    })
  })

  test('seats the user in the first human slot by default, as random when the race is free', () => {
    const { playerInfos } = buildSoloGameSlots({ map: COMPUTERS_OWN_FORCE, userId: USER })

    expect(withoutIds(playerInfos)).toEqual([
      { userId: USER, race: 'r', playerId: 0, type: SlotType.Human, typeId: 6, teamId: 1 },
      { userId: undefined, race: 'r', playerId: 1, type: SlotType.Open, typeId: 6, teamId: 1 },
      {
        userId: undefined,
        race: 'z',
        playerId: 2,
        type: SlotType.UmsComputer,
        typeId: 5,
        teamId: 2,
      },
      {
        userId: undefined,
        race: 't',
        playerId: 3,
        type: SlotType.UmsComputer,
        typeId: 5,
        teamId: 2,
      },
    ])
  })

  test('takes the race the map fixes for the slot when none is asked for', () => {
    const { playerInfos } = buildSoloGameSlots({ map: MIXED_FORCES, userId: USER })
    expect(playerInfos.find(p => p.userId === USER)).toMatchObject({ race: 't', playerId: 0 })
  })

  test('accepts the race the map fixes for the slot', () => {
    const { playerInfos } = buildSoloGameSlots({ map: MIXED_FORCES, userId: USER, race: 't' })
    expect(playerInfos.find(p => p.userId === USER)).toMatchObject({ race: 't' })
  })

  test('sends hidden slots after the visible ones of their force', () => {
    const { playerInfos } = buildSoloGameSlots({ map: HIDDEN_SLOTS, userId: USER })
    expect(playerInfos.map(p => [p.playerId, p.type])).toEqual([
      [0, SlotType.Human],
      [1, SlotType.UmsComputer],
      [3, SlotType.UmsComputer],
      [4, SlotType.Open],
      [2, SlotType.UmsComputer],
    ])
  })

  test("builds the config's teams per force from its human and visible computers", () => {
    expect(buildSoloGameSlots({ map: HIDDEN_SLOTS, userId: USER, race: 'p' }).teams).toEqual([
      [{ id: USER, race: 'p', isComputer: false }],
      [{ id: COMPUTER_ID, race: 'z', isComputer: true }],
    ])
    expect(buildSoloGameSlots({ map: SEVERAL_HUMANS, userId: USER, slot: 4 }).teams).toEqual([
      [],
      [{ id: COMPUTER_ID, race: 'p', isComputer: true }],
      [{ id: USER, race: 'r', isComputer: false }],
    ])
  })

  test('refuses a slot that is a computer', () => {
    expectRefusal(
      () => buildSoloGameSlots({ map: MIXED_FORCES, userId: USER, slot: 1 }),
      SoloGameServiceErrorCode.InvalidSlot,
    )
  })

  test('refuses a slot the map does not have', () => {
    expectRefusal(
      () => buildSoloGameSlots({ map: MIXED_FORCES, userId: USER, slot: 6 }),
      SoloGameServiceErrorCode.InvalidSlot,
    )
  })

  test('refuses a race other than the one the map fixes for the slot', () => {
    expectRefusal(
      () => buildSoloGameSlots({ map: MIXED_FORCES, userId: USER, slot: 0, race: 'z' }),
      SoloGameServiceErrorCode.InvalidRace,
    )
    expectRefusal(
      () => buildSoloGameSlots({ map: MIXED_FORCES, userId: USER, slot: 0, race: 'r' }),
      SoloGameServiceErrorCode.InvalidRace,
    )
  })
})

describe('common/solo-games/canPlayMapAlone', () => {
  test.each(FIXTURES.map(map => [map.name, map] as const))('accepts %s', (_name, map) => {
    expect(canPlayMapAlone(map.kind, map.mapData.umsForces)).toBe(true)
  })

  test('refuses a melee map', () => {
    expect(canPlayMapAlone('melee', COMPUTERS_OWN_FORCE.mapData.umsForces)).toBe(false)
  })

  test('refuses a map without a computer', () => {
    expect(
      canPlayMapAlone('ums', [
        {
          players: [
            { computer: false, typeId: 6 },
            { computer: false, typeId: 6 },
          ],
        },
      ]),
    ).toBe(false)
  })

  test('refuses a map whose only computers are hidden', () => {
    expect(
      canPlayMapAlone('ums', [
        { players: [{ computer: false, typeId: 6 }] },
        {
          players: [
            { computer: true, typeId: 3 },
            { computer: true, typeId: 7 },
          ],
        },
      ]),
    ).toBe(false)
  })

  test('refuses a map without a human slot', () => {
    expect(canPlayMapAlone('ums', [{ players: [{ computer: true, typeId: 5 }] }])).toBe(false)
  })

  test('agrees with whether a lobby with only its host has opposing sides', () => {
    const maps = [
      ...FIXTURES,
      umsMap('no-computer', [
        { name: 'All', teamId: 1, players: [{ id: 0, race: 'any', typeId: 6, computer: false }] },
      ]),
      umsMap('only-hidden', [
        { name: 'A', teamId: 1, players: [{ id: 0, race: 'any', typeId: 6, computer: false }] },
        { name: 'B', teamId: 2, players: [{ id: 1, race: 'z', typeId: 7, computer: true }] },
      ]),
    ]
    for (const map of maps) {
      const lobby = Lobbies.createLobby({
        name: 'Solo',
        map,
        gameType: GameType.UseMapSettings,
        numSlots: map.mapData.slots,
        hostUserId: USER,
        allowObservers: false,
      })
      expect(canPlayMapAlone(map.kind, map.mapData.umsForces)).toBe(hasOpposingSides(lobby))
    }
  })
})
