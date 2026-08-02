import { describe, expect, test } from 'vitest'
import { GameType } from '../../common/games/game-type'
import { Lobby } from '../../common/lobbies'
import { Slot, SlotType } from '../../common/lobbies/slot'
import { LobbyActions } from './actions'
import lobbyReducerImport, { isInLobby, LobbyState } from './lobby-reducer'

// `immerKeyedReducer` accepts any action with a string `type`. These tests only ever feed it lobby
// actions, so narrow the parameter to those, both for the extra checking and so that action objects
// can be written inline without tripping excess property checks.
const lobbyReducer: (state: LobbyState | undefined, action: LobbyActions) => LobbyState =
  lobbyReducerImport

const HOST_SLOT: Slot = {
  type: SlotType.Human,
  userId: 1 as any,
  race: 'r',
  id: 'host-slot',
  joinedAt: 0,
  hasForcedRace: false,
  playerId: 0,
  typeId: 0,
}

const SLOT_A: Slot = {
  type: SlotType.Human,
  userId: 2 as any,
  race: 'z',
  id: 'slot-a',
  joinedAt: 0,
  hasForcedRace: false,
  playerId: 1,
  typeId: 0,
}

const SLOT_B: Slot = {
  type: SlotType.Open,
  race: 'r',
  id: 'slot-b',
  joinedAt: 0,
  hasForcedRace: false,
  playerId: 2,
  typeId: 0,
}

const LOBBY: Lobby = {
  id: 'lobby-1' as any,
  name: 'Test Lobby',
  map: undefined,
  gameType: GameType.Melee,
  gameSubType: 0,
  teams: [
    {
      name: 'Team 1',
      teamId: 0,
      isObserver: false,
      slots: [HOST_SLOT, SLOT_A, SLOT_B],
      hiddenSlots: [],
    },
  ],
  host: HOST_SLOT,
  useLegacyLimits: false,
  visibility: 'listed',
}

function initAction(): LobbyActions {
  return { type: '@lobbies/init', payload: { type: 'init', lobby: LOBBY, userInfos: [] } }
}

describe('client/lobbies/lobby-reducer', () => {
  test('init stores the payload lobby as state.info directly', () => {
    const state = lobbyReducer(undefined, initAction())

    expect(state.info).toBe(LOBBY)
  })

  test('slotCreate replaces the targeted slot and leaves the others untouched', () => {
    let state = lobbyReducer(undefined, initAction())

    const newSlot: Slot = {
      type: SlotType.Human,
      userId: 3 as any,
      race: 'p',
      id: 'slot-c',
      joinedAt: 0,
      hasForcedRace: false,
      playerId: 2,
      typeId: 0,
    }
    state = lobbyReducer(state, {
      type: '@lobbies/updateSlotCreate',
      payload: { type: 'slotCreate', teamIndex: 0, slotIndex: 2, slot: newSlot },
    })

    expect(state.info.teams[0].slots[2]).toEqual(newSlot)
    expect(state.info.teams[0].slots[0]).toEqual(HOST_SLOT)
    expect(state.info.teams[0].slots[1]).toEqual(SLOT_A)
  })

  test('raceChange updates just the race of the targeted slot', () => {
    let state = lobbyReducer(undefined, initAction())

    state = lobbyReducer(state, {
      type: '@lobbies/updateRaceChange',
      payload: { type: 'raceChange', teamIndex: 0, slotIndex: 1, newRace: 'p' },
    })

    expect(state.info.teams[0].slots[1]).toEqual({ ...SLOT_A, race: 'p' })
    expect(state.info.teams[0].slots[0]).toEqual(HOST_SLOT)
    expect(state.info.teams[0].slots[2]).toEqual(SLOT_B)
  })

  test('a slotCreate trailing our own kick does not throw and leaves us out of the lobby', () => {
    let state = lobbyReducer(undefined, initAction())
    state = lobbyReducer(state, { type: '@lobbies/updateKickSelf' })

    expect(() => {
      state = lobbyReducer(state, {
        type: '@lobbies/updateSlotCreate',
        payload: { type: 'slotCreate', teamIndex: 0, slotIndex: 1, slot: SLOT_A },
      })
    }).not.toThrow()

    expect(state.info.name).toBe('')
    expect(isInLobby(state)).toBe(false)
  })

  test('a raceChange trailing our own leave does not throw and leaves us out of the lobby', () => {
    let state = lobbyReducer(undefined, initAction())
    state = lobbyReducer(state, { type: '@lobbies/updateLeaveSelf' })

    expect(() => {
      state = lobbyReducer(state, {
        type: '@lobbies/updateRaceChange',
        payload: { type: 'raceChange', teamIndex: 0, slotIndex: 1, newRace: 'p' },
      })
    }).not.toThrow()

    expect(state.info.name).toBe('')
    expect(isInLobby(state)).toBe(false)
  })

  test('a hostChange trailing our own ban does not throw and leaves us out of the lobby', () => {
    let state = lobbyReducer(undefined, initAction())
    state = lobbyReducer(state, { type: '@lobbies/updateBanSelf' })

    expect(() => {
      state = lobbyReducer(state, {
        type: '@lobbies/updateHostChange',
        payload: SLOT_A,
      })
    }).not.toThrow()

    expect(state.info.name).toBe('')
    expect(isInLobby(state)).toBe(false)
  })
})
