import { describe, expect, test } from 'vitest'
import { GameType } from '../../common/games/game-type'
import { BenchedUser, Lobby } from '../../common/lobbies'
import { LobbySeriesGameJson } from '../../common/lobbies/lobby-network'
import { Slot, SlotType } from '../../common/lobbies/slot'
import { SbMapId } from '../../common/maps'
import { SbUserId } from '../../common/users/sb-user-id'
import { LobbyActions } from './actions'
import {
  BenchJoinMessage,
  KickLobbyPlayerMessage,
  LobbyMemberGameEndedMessage,
  LobbyMessageType,
  LobbyRegroupMessage,
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
  createdAt: 0,
}

const BENCHED_USER: BenchedUser = {
  userId: 4 as any,
  race: 't',
  joinedAt: 0,
}

const SERIES_GAME: LobbySeriesGameJson = {
  gameId: 'game-0',
  mapId: 'map-1' as SbMapId,
  teams: [
    { name: 'Team 1', players: [{ type: 'human', userId: HOST_SLOT.userId!, race: 'r' }] },
    { name: 'Team 2', players: [{ type: 'computer', race: 'z' }] },
  ],
}

function initAction(
  extra: Partial<{ readyUsers: SbUserId[]; series: LobbySeriesGameJson[] }> = {},
): LobbyActions {
  return {
    type: '@lobbies/init',
    payload: {
      type: 'init',
      lobby: LOBBY,
      userInfos: [],
      readyUsers: extra.readyUsers ?? [],
      series: extra.series ?? [],
    },
  }
}

/** Puts both of the lobby's seated humans on the ready list, the way a full ready check would. */
function readyBoth(state: CurrentLobbyState): CurrentLobbyState {
  let next = lobbyReducer(state, {
    type: '@lobbies/updateReadyChange',
    payload: { type: 'readyChange', userId: HOST_SLOT.userId!, isReady: true },
  })
  next = lobbyReducer(next, {
    type: '@lobbies/updateReadyChange',
    payload: { type: 'readyChange', userId: SLOT_A.userId!, isReady: true },
  })
  return next
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

  test('a slotCreate naming a team the current layout does not have is dropped', () => {
    let state = lobbyReducer(undefined, initAction())

    expect(() => {
      state = lobbyReducer(state, {
        type: '@lobbies/updateSlotCreate',
        payload: { type: 'slotCreate', teamIndex: 3, slotIndex: 0, slot: SLOT_A },
      })
    }).not.toThrow()

    expect(state.info.teams).toHaveLength(1)
    expect(state.info.teams[0].slots).toEqual([HOST_SLOT, SLOT_A, SLOT_B])
  })

  test('a raceChange naming a slot past the end of its team is dropped', () => {
    let state = lobbyReducer(undefined, initAction())

    expect(() => {
      state = lobbyReducer(state, {
        type: '@lobbies/updateRaceChange',
        payload: { type: 'raceChange', teamIndex: 0, slotIndex: 7, newRace: 'p' },
      })
    }).not.toThrow()

    expect(state.info.teams[0].slots).toEqual([HOST_SLOT, SLOT_A, SLOT_B])
  })

  test('a slotChange naming a slot past the end of its team is dropped', () => {
    let state = lobbyReducer(undefined, initAction())

    expect(() => {
      state = lobbyReducer(state, {
        type: '@lobbies/updateSlotChange',
        payload: { type: 'slotChange', teamIndex: 0, slotIndex: 7, player: SLOT_A },
      })
    }).not.toThrow()

    expect(state.info.teams[0].slots).toEqual([HOST_SLOT, SLOT_A, SLOT_B])
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

  test('gameStarted keeps state.info and sets runState', () => {
    let state = lobbyReducer(undefined, initAction())

    state = lobbyReducer(state, {
      type: '@lobbies/updateGameStarted',
      payload: {
        runState: {
          gameId: 'game-1',
          inGameUsers: [HOST_SLOT.userId!, SLOT_A.userId!],
          elapsedMs: 0,
        },
        isParticipant: true,
      },
    })

    expect(state.info).toBe(LOBBY)
    expect(state.runState?.gameId).toBe('game-1')
    expect(state.runState?.inGameUsers).toEqual([HOST_SLOT.userId, SLOT_A.userId])
    const lastMessage = state.chat[state.chat.length - 1]
    expect(lastMessage.type).toBe(LobbyMessageType.LobbyGameStarted)
  })

  test('a gameStarted trailing our own leave does not throw and leaves us out of the lobby', () => {
    let state = lobbyReducer(undefined, initAction())
    state = lobbyReducer(state, { type: '@lobbies/updateLeaveSelf' })

    expect(() => {
      state = lobbyReducer(state, {
        type: '@lobbies/updateGameStarted',
        payload: {
          runState: { gameId: 'game-1', inGameUsers: [], elapsedMs: 0 },
          isParticipant: true,
        },
      })
    }).not.toThrow()

    expect(state.info.name).toBe('')
    expect(state.runState).toBeUndefined()
    expect(isInLobby(state)).toBe(false)
  })

  test('memberGameEnded removes the user from runState.inGameUsers and logs a chat message', () => {
    let state = lobbyReducer(undefined, initAction())
    state = lobbyReducer(state, {
      type: '@lobbies/updateGameStarted',
      payload: {
        runState: {
          gameId: 'game-1',
          inGameUsers: [HOST_SLOT.userId!, SLOT_A.userId!],
          elapsedMs: 0,
        },
        isParticipant: true,
      },
    })

    state = lobbyReducer(state, {
      type: '@lobbies/updateMemberGameEnded',
      payload: { type: 'memberGameEnded', userId: HOST_SLOT.userId! },
    })

    expect(state.runState?.inGameUsers).toEqual([SLOT_A.userId])
    const lastMessage = state.chat[state.chat.length - 1]
    expect(lastMessage.type).toBe(LobbyMessageType.LobbyMemberGameEnded)
    expect((lastMessage as LobbyMemberGameEndedMessage).userId).toBe(HOST_SLOT.userId)
  })

  test('regroup clears runState and logs the finished game', () => {
    let state = lobbyReducer(undefined, initAction())
    state = lobbyReducer(state, {
      type: '@lobbies/updateGameStarted',
      payload: {
        runState: { gameId: 'game-1', inGameUsers: [], elapsedMs: 0 },
        isParticipant: true,
      },
    })

    state = lobbyReducer(state, {
      type: '@lobbies/updateRegroup',
      payload: { type: 'regroup', game: { ...SERIES_GAME, gameId: 'game-1' } },
    })

    expect(state.info).toBe(LOBBY)
    expect(state.runState).toBeUndefined()
    expect(state.series.map(g => g.gameId)).toEqual(['game-1'])
    const lastMessage = state.chat[state.chat.length - 1]
    expect(lastMessage.type).toBe(LobbyMessageType.LobbyRegroup)
    expect((lastMessage as LobbyRegroupMessage).gameId).toBe('game-1')
  })

  test('init stores runState when the event carries one (e.g. joining an in-game lobby)', () => {
    const state = lobbyReducer(undefined, {
      type: '@lobbies/init',
      payload: {
        type: 'init',
        lobby: LOBBY,
        userInfos: [],
        readyUsers: [],
        series: [],
        runState: { gameId: 'game-2', inGameUsers: [HOST_SLOT.userId!], elapsedMs: 0 },
      },
    })

    expect(state.runState?.gameId).toBe('game-2')
    expect(state.runState?.inGameUsers).toEqual([HOST_SLOT.userId])
  })

  test('init seeds the ready members and the games played so far', () => {
    const state = lobbyReducer(
      undefined,
      initAction({ readyUsers: [SLOT_A.userId!], series: [SERIES_GAME] }),
    )

    expect(state.readyUserIds).toEqual([SLOT_A.userId])
    expect(state.series).toEqual([SERIES_GAME])
  })

  test('readyChange adds and removes a single member, ignoring repeats', () => {
    let state = lobbyReducer(undefined, initAction())

    state = lobbyReducer(state, {
      type: '@lobbies/updateReadyChange',
      payload: { type: 'readyChange', userId: SLOT_A.userId!, isReady: true },
    })
    state = lobbyReducer(state, {
      type: '@lobbies/updateReadyChange',
      payload: { type: 'readyChange', userId: SLOT_A.userId!, isReady: true },
    })
    expect(state.readyUserIds).toEqual([SLOT_A.userId])

    state = lobbyReducer(state, {
      type: '@lobbies/updateReadyChange',
      payload: { type: 'readyChange', userId: SLOT_A.userId!, isReady: false },
    })
    expect(state.readyUserIds).toEqual([])
  })

  test('a readyChange trailing our own leave does not throw and adds nobody', () => {
    let state = lobbyReducer(undefined, initAction())
    state = lobbyReducer(state, { type: '@lobbies/updateLeaveSelf' })

    expect(() => {
      state = lobbyReducer(state, {
        type: '@lobbies/updateReadyChange',
        payload: { type: 'readyChange', userId: SLOT_A.userId!, isReady: true },
      })
    }).not.toThrow()

    expect(state.readyUserIds).toEqual([])
    expect(isInLobby(state)).toBe(false)
  })

  test('leaving, being kicked, and being banned each drop only that member from ready', () => {
    for (const action of [
      { type: '@lobbies/updateLeave', payload: { type: 'leave', player: SLOT_A } },
      { type: '@lobbies/updateKick', payload: { type: 'kick', player: SLOT_A } },
      { type: '@lobbies/updateBan', payload: { type: 'ban', player: SLOT_A } },
    ] as LobbyActions[]) {
      let state = readyBoth(lobbyReducer(undefined, initAction()))
      state = lobbyReducer(state, action)

      expect(state.readyUserIds).toEqual([HOST_SLOT.userId])
    }
  })

  test('a settings change other than a rename clears every ready mark', () => {
    let state = readyBoth(lobbyReducer(undefined, initAction()))

    state = lobbyReducer(state, {
      type: '@lobbies/updateSettingsChange',
      payload: { type: 'settingsChange', changedSettings: ['name'], lobby: { ...LOBBY } },
    })
    expect(state.readyUserIds).toEqual([HOST_SLOT.userId, SLOT_A.userId])

    state = lobbyReducer(state, {
      type: '@lobbies/updateSettingsChange',
      payload: { type: 'settingsChange', changedSettings: ['name', 'map'], lobby: { ...LOBBY } },
    })
    expect(state.readyUserIds).toEqual([])
  })

  test('starting a game and regrouping out of it both clear every ready mark', () => {
    let state = readyBoth(lobbyReducer(undefined, initAction()))

    state = lobbyReducer(state, {
      type: '@lobbies/updateGameStarted',
      payload: {
        runState: { gameId: 'game-1', inGameUsers: [], elapsedMs: 0 },
        isParticipant: true,
      },
    })
    expect(state.readyUserIds).toEqual([])

    state = readyBoth(state)
    state = lobbyReducer(state, {
      type: '@lobbies/updateRegroup',
      payload: { type: 'regroup', game: { ...SERIES_GAME, gameId: 'game-1' } },
    })
    expect(state.readyUserIds).toEqual([])
  })

  test('seriesGameUpdated settles the named game and leaves the rest of the series alone', () => {
    let state = lobbyReducer(
      undefined,
      initAction({
        series: [SERIES_GAME, { ...SERIES_GAME, gameId: 'game-1' }],
      }),
    )

    state = lobbyReducer(state, {
      type: '@lobbies/updateSeriesGameUpdated',
      payload: {
        type: 'seriesGameUpdated',
        gameId: 'game-1',
        result: { winningTeamIndex: 0, durationMs: 1000 },
      },
    })

    expect(state.series[0].result).toBeUndefined()
    expect(state.series[1].result).toEqual({ winningTeamIndex: 0, durationMs: 1000 })
  })

  test('a seriesGameUpdated for a game we never saw is dropped', () => {
    let state = lobbyReducer(undefined, initAction({ series: [SERIES_GAME] }))

    expect(() => {
      state = lobbyReducer(state, {
        type: '@lobbies/updateSeriesGameUpdated',
        payload: {
          type: 'seriesGameUpdated',
          gameId: 'game-nobody-here-has-heard-of',
          result: { durationMs: 1000 },
        },
      })
    }).not.toThrow()

    expect(state.series).toEqual([SERIES_GAME])
  })

  test('leaving the lobby forgets its ready marks and its games', () => {
    let state = readyBoth(lobbyReducer(undefined, initAction({ series: [SERIES_GAME] })))

    state = lobbyReducer(state, { type: '@lobbies/updateLeaveSelf' })

    expect(state.readyUserIds).toEqual([])
    expect(state.series).toEqual([])
  })
})
