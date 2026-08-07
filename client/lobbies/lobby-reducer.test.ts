import { describe, expect, test } from 'vitest'
import { GameType } from '../../common/games/game-type'
import { BenchedUser, Lobby } from '../../common/lobbies'
import { Slot, SlotType } from '../../common/lobbies/slot'
import { LobbyActions } from './actions'
import {
  BenchJoinMessage,
  KickLobbyPlayerMessage,
  LobbyMessageType,
  SettingsChangeMessage,
} from './lobby-message-records'
import lobbyReducerImport, { CurrentLobbyState, isInLobby } from './lobby-reducer'

// `immerKeyedReducer` accepts any action with a string `type`. These tests only ever feed it lobby
// actions, so narrow the parameter to those, both for the extra checking and so that action objects
// can be written inline without tripping excess property checks.
const lobbyReducer: (
  state: CurrentLobbyState | undefined,
  action: LobbyActions,
) => CurrentLobbyState = lobbyReducerImport

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
  bench: [],
  host: HOST_SLOT,
  useLegacyLimits: false,
  visibility: 'listed',
}

const BENCHED_USER: BenchedUser = {
  userId: 4 as any,
  race: 't',
  joinedAt: 0,
}

function initAction(): LobbyActions {
  return { type: '@lobbies/init', payload: { type: 'init', lobby: LOBBY, userInfos: [] } }
}

function chatAction(text: string): LobbyActions {
  return {
    type: '@lobbies/updateChatMessage',
    payload: {
      type: 'chat',
      message: { lobbyName: LOBBY.name, time: 27, from: HOST_SLOT.userId!, text },
      mentions: [],
      channelMentions: [],
    },
  }
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

  test('chat while activated stays read; leaving with messages in the log queues hasUnread', () => {
    let state = lobbyReducer(undefined, initAction())
    state = lobbyReducer(state, { type: '@lobbies/activate' })
    expect(state.activated).toBe(true)
    expect(state.hasUnread).toBe(false)

    state = lobbyReducer(state, chatAction('hey'))
    expect(state.hasUnread).toBe(false)

    state = lobbyReducer(state, { type: '@lobbies/updateLeaveSelf' })
    expect(state.chat).toHaveLength(0)
    expect(state.activated).toBe(false)
    expect(state.hasUnread).toBe(true)
  })

  test('chat while deactivated marks unread; activating clears it', () => {
    let state = lobbyReducer(undefined, initAction())
    state = lobbyReducer(state, { type: '@lobbies/activate' })
    state = lobbyReducer(state, { type: '@lobbies/deactivate' })

    state = lobbyReducer(state, chatAction('hey'))
    expect(state.hasUnread).toBe(true)

    state = lobbyReducer(state, { type: '@lobbies/activate' })
    expect(state.hasUnread).toBe(false)
  })

  test('actions arriving while out of a lobby leave the state referentially unchanged', () => {
    let state = lobbyReducer(undefined, initAction())
    state = lobbyReducer(state, { type: '@lobbies/updateLeaveSelf' })
    // The first out-of-lobby action still settles the hasUnread queued up by leaving
    state = lobbyReducer(state, { type: '@lobbies/deactivate' })

    const settled = lobbyReducer(state, { type: '@lobbies/deactivate' })
    expect(settled).toBe(state)
  })

  test('the chat cap trims at most one entry per push, even for multi-message pushes', () => {
    let state = lobbyReducer(undefined, initAction())
    // The init self-join message plus 199 chat messages fills the log to the 200-message cap
    for (let i = 1; i < 200; i++) {
      state = lobbyReducer(state, chatAction(`msg ${i}`))
    }
    expect(state.chat).toHaveLength(200)

    state = lobbyReducer(state, chatAction('one more'))
    expect(state.chat).toHaveLength(200)

    // The countdown start pushes two messages (started + first tick) but still trims just one
    state = lobbyReducer(state, { type: '@lobbies/updateCountdownStart', payload: 5 })
    expect(state.chat).toHaveLength(201)
  })

  test('settingsChange replaces state.info with the reconciled lobby and logs a chat message', () => {
    let state = lobbyReducer(undefined, initAction())

    const newLobby: Lobby = { ...LOBBY, useLegacyLimits: true }
    state = lobbyReducer(state, {
      type: '@lobbies/updateSettingsChange',
      payload: { type: 'settingsChange', changedSettings: ['useLegacyLimits'], lobby: newLobby },
    })

    expect(state.info).toBe(newLobby)
    const lastMessage = state.chat[state.chat.length - 1]
    expect(lastMessage.type).toBe(LobbyMessageType.LobbySettingsChange)
    expect((lastMessage as SettingsChangeMessage).changedSettings).toEqual(['useLegacyLimits'])
  })

  test('a settingsChange trailing our own leave does not throw and leaves us out of the lobby', () => {
    let state = lobbyReducer(undefined, initAction())
    state = lobbyReducer(state, { type: '@lobbies/updateLeaveSelf' })

    expect(() => {
      state = lobbyReducer(state, {
        type: '@lobbies/updateSettingsChange',
        payload: { type: 'settingsChange', changedSettings: ['gameType'], lobby: { ...LOBBY } },
      })
    }).not.toThrow()

    expect(state.info.name).toBe('')
    expect(isInLobby(state)).toBe(false)
  })

  test('benchAdd pushes the user onto the bench and logs a chat message', () => {
    let state = lobbyReducer(undefined, initAction())

    state = lobbyReducer(state, {
      type: '@lobbies/updateBenchAdd',
      payload: { type: 'benchAdd', user: BENCHED_USER },
    })

    expect(state.info.bench).toEqual([BENCHED_USER])
    const lastMessage = state.chat[state.chat.length - 1]
    expect(lastMessage.type).toBe(LobbyMessageType.LobbyBenchJoin)
    expect((lastMessage as BenchJoinMessage).userId).toBe(BENCHED_USER.userId)
  })

  test('a benchAdd trailing our own kick does not throw and leaves us out of the lobby', () => {
    let state = lobbyReducer(undefined, initAction())
    state = lobbyReducer(state, { type: '@lobbies/updateKickSelf' })

    expect(() => {
      state = lobbyReducer(state, {
        type: '@lobbies/updateBenchAdd',
        payload: { type: 'benchAdd', user: BENCHED_USER },
      })
    }).not.toThrow()

    expect(state.info.name).toBe('')
    expect(isInLobby(state)).toBe(false)
  })

  test('a benchRemove without a reason (a seating) logs no chat message', () => {
    let state = lobbyReducer(undefined, initAction())
    state = lobbyReducer(state, {
      type: '@lobbies/updateBenchAdd',
      payload: { type: 'benchAdd', user: BENCHED_USER },
    })
    const chatLengthAfterAdd = state.chat.length

    state = lobbyReducer(state, {
      type: '@lobbies/updateBenchRemove',
      payload: { type: 'benchRemove', userId: BENCHED_USER.userId },
    })

    expect(state.info.bench).toEqual([])
    expect(state.chat.length).toBe(chatLengthAfterAdd)
  })

  test('a benchRemove carrying a departure reason logs the matching chat message', () => {
    let state = lobbyReducer(undefined, initAction())
    state = lobbyReducer(state, {
      type: '@lobbies/updateBenchAdd',
      payload: { type: 'benchAdd', user: BENCHED_USER },
    })

    state = lobbyReducer(state, {
      type: '@lobbies/updateBenchRemove',
      payload: { type: 'benchRemove', userId: BENCHED_USER.userId, reason: 'kicked' },
    })

    expect(state.info.bench).toEqual([])
    const lastMessage = state.chat[state.chat.length - 1]
    expect(lastMessage.type).toBe(LobbyMessageType.KickLobbyPlayer)
    expect((lastMessage as KickLobbyPlayerMessage).userId).toBe(BENCHED_USER.userId)
  })

  test('a benchRemove trailing our own ban does not throw and leaves us out of the lobby', () => {
    let state = lobbyReducer(undefined, initAction())
    state = lobbyReducer(state, { type: '@lobbies/updateBanSelf' })

    expect(() => {
      state = lobbyReducer(state, {
        type: '@lobbies/updateBenchRemove',
        payload: { type: 'benchRemove', userId: BENCHED_USER.userId },
      })
    }).not.toThrow()

    expect(state.info.name).toBe('')
    expect(isInLobby(state)).toBe(false)
  })
})
