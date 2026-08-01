import { describe, expect, test } from 'vitest'
import { GameType } from '../../common/games/game-type'
import { Lobby } from '../../common/lobbies'
import { Slot, SlotType } from '../../common/lobbies/slot'
import {
  LOBBY_INIT_DATA,
  LOBBY_UPDATE_BAN_SELF,
  LOBBY_UPDATE_HOST_CHANGE,
  LOBBY_UPDATE_KICK_SELF,
  LOBBY_UPDATE_LEAVE_SELF,
  LOBBY_UPDATE_RACE_CHANGE,
  LOBBY_UPDATE_SLOT_CREATE,
} from '../actions'
import lobbyReducerImport, { LobbyRecord } from './lobby-reducer'

// `lobby-reducer.js` is untyped JS; give the default export a minimal, honest signature for use
// in these tests rather than fighting inference on every call site.
const lobbyReducer = lobbyReducerImport as (
  state: LobbyRecord | undefined,
  action: { type: string; payload?: any },
) => LobbyRecord

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

function initAction() {
  return { type: LOBBY_INIT_DATA, payload: { lobby: LOBBY, userInfos: [] } }
}

describe('client/lobbies/lobby-reducer', () => {
  test('LOBBY_INIT_DATA stores the payload lobby as state.info directly', () => {
    const state = lobbyReducer(undefined, initAction())

    expect(state.info).toBe(LOBBY)
  })

  test('LOBBY_UPDATE_SLOT_CREATE replaces the targeted slot and leaves the others untouched', () => {
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
      type: LOBBY_UPDATE_SLOT_CREATE,
      payload: { teamIndex: 0, slotIndex: 2, slot: newSlot },
    })

    expect(state.info.teams[0].slots[2]).toEqual(newSlot)
    expect(state.info.teams[0].slots[0]).toEqual(HOST_SLOT)
    expect(state.info.teams[0].slots[1]).toEqual(SLOT_A)
  })

  test('LOBBY_UPDATE_RACE_CHANGE updates just the race of the targeted slot', () => {
    let state = lobbyReducer(undefined, initAction())

    state = lobbyReducer(state, {
      type: LOBBY_UPDATE_RACE_CHANGE,
      payload: { teamIndex: 0, slotIndex: 1, newRace: 'p' },
    })

    expect(state.info.teams[0].slots[1]).toEqual({ ...SLOT_A, race: 'p' })
    expect(state.info.teams[0].slots[0]).toEqual(HOST_SLOT)
    expect(state.info.teams[0].slots[2]).toEqual(SLOT_B)
  })

  test('a slotCreate trailing our own kick does not throw and leaves us out of the lobby', () => {
    let state = lobbyReducer(undefined, initAction())
    state = lobbyReducer(state, { type: LOBBY_UPDATE_KICK_SELF })

    expect(() => {
      state = lobbyReducer(state, {
        type: LOBBY_UPDATE_SLOT_CREATE,
        payload: { teamIndex: 0, slotIndex: 1, slot: SLOT_A },
      })
    }).not.toThrow()

    expect(state.info.name).toBe('')
    expect(state.inLobby).toBe(false)
  })

  test('a raceChange trailing our own leave does not throw and leaves us out of the lobby', () => {
    let state = lobbyReducer(undefined, initAction())
    state = lobbyReducer(state, { type: LOBBY_UPDATE_LEAVE_SELF })

    expect(() => {
      state = lobbyReducer(state, {
        type: LOBBY_UPDATE_RACE_CHANGE,
        payload: { teamIndex: 0, slotIndex: 1, newRace: 'p' },
      })
    }).not.toThrow()

    expect(state.info.name).toBe('')
    expect(state.inLobby).toBe(false)
  })

  test('a hostChange trailing our own ban does not throw and leaves us out of the lobby', () => {
    let state = lobbyReducer(undefined, initAction())
    state = lobbyReducer(state, { type: LOBBY_UPDATE_BAN_SELF })

    expect(() => {
      state = lobbyReducer(state, {
        type: LOBBY_UPDATE_HOST_CHANGE,
        payload: SLOT_A,
      })
    }).not.toThrow()

    expect(state.info.name).toBe('')
    expect(state.inLobby).toBe(false)
  })
})
