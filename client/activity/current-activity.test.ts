import { describe, expect, test } from 'vitest'
import { GameStatusString } from '../../common/games/game-status'
import { GameType } from '../../common/games/game-type'
import { Lobby, Team } from '../../common/lobbies'
import { makeSbLobbyId } from '../../common/lobbies/sb-lobby-id'
import {
  createClosed,
  createComputer,
  createHuman,
  createObserver,
  createOpen,
  SlotType,
} from '../../common/lobbies/slot'
import { MapInfo } from '../../common/maps'
import { MatchmakingType } from '../../common/matchmaking'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { ParticipatingGameInfo } from '../games/game-atoms'
import { CurrentActivityState, getCurrentActivity } from './current-activity'

const SELF = makeSbUserId(1)
const OTHER = makeSbUserId(2)
const LOBBY_ID = makeSbLobbyId('Ek0xQmQzSXu9vMSq1Ya2Ww')

function team(slots: Team['slots'], isObserver = false): Team {
  return { name: '', teamId: 0, isObserver, slots, hiddenSlots: [] }
}

const LOBBY = {
  id: LOBBY_ID,
  name: 'Fastest 3v3',
  visibility: 'listed',
  map: {
    name: 'Fastest',
    image512Url: 'https://cdn.example/fastest-512.jpg',
    image1024Url: 'https://cdn.example/fastest-1024.jpg',
  } as Partial<MapInfo> as MapInfo,
  teams: [
    team([createHuman(SELF, 'z'), createComputer('t'), createOpen(), createClosed()]),
    team([createObserver(OTHER), createOpen()], true),
  ],
  bench: [],
} as Partial<Lobby> as Lobby

/** What `LOBBY` tells others about joining it: 2 people, 4 slots a person can be in and the bench. */
const JOINABLE_LOBBY = {
  id: LOBBY_ID,
  visibility: 'listed',
  memberCount: 2,
  capacity: 12,
} as const

const GAME: ParticipatingGameInfo = {
  gameId: 'game-1',
  gameType: GameType.Melee,
  mapName: 'Polypoid',
  slots: [
    { userId: OTHER, race: 'z', type: SlotType.Human },
    { userId: SELF, race: 'p', type: SlotType.Human },
  ],
  playingSince: 1_000_000,
}

function stateWith(overrides: Partial<CurrentActivityState>): CurrentActivityState {
  return {
    userId: SELF,
    lobby: undefined,
    gameClient: { watchOnly: {} },
    participatingGame: undefined,
    watchedReplay: undefined,
    ...overrides,
  }
}

/** Returns a game client whose participating game `gameId` is in `state`. */
function gameClientIn(gameId: string, state: GameStatusString): CurrentActivityState['gameClient'] {
  return { gameId, status: { id: gameId, state, isReplay: false }, watchOnly: {} }
}

/** Returns a game client watching the replays of `gameIds`, each in `state`. */
function watching(gameIds: string[], state: GameStatusString): CurrentActivityState['gameClient'] {
  return {
    watchOnly: Object.fromEntries(gameIds.map(id => [id, { id, state, isReplay: true }])),
  }
}

describe('client/activity/current-activity', () => {
  test('a lobby counts its people and the slots and bench places they could be in', () => {
    expect(getCurrentActivity(stateWith({ lobby: LOBBY }))).toEqual({
      kind: 'lobby',
      ...JOINABLE_LOBBY,
      name: 'Fastest 3v3',
      mapName: 'Fastest',
      mapImageUrl: 'https://cdn.example/fastest-1024.jpg',
      ownRace: 'z',
      observing: false,
    })
  })

  test('a lobby observer has no race and is marked as observing', () => {
    const activity = getCurrentActivity(stateWith({ userId: OTHER, lobby: LOBBY }))
    expect(activity).toMatchObject({ kind: 'lobby', ownRace: undefined, observing: true })
  })

  test('a lobby counts those on its bench as people in it', () => {
    const lobby: Lobby = {
      ...LOBBY,
      bench: [{ userId: makeSbUserId(3), race: 'r', joinedAt: 0 }],
    }
    expect(getCurrentActivity(stateWith({ userId: makeSbUserId(3), lobby }))).toMatchObject({
      kind: 'lobby',
      memberCount: 3,
      capacity: 12,
      ownRace: undefined,
      observing: false,
    })
  })

  test('a lobby stays while its game is loading', () => {
    expect(
      getCurrentActivity(
        stateWith({
          lobby: LOBBY,
          gameClient: gameClientIn('game-1', 'launching'),
          participatingGame: GAME,
        }),
      ),
    ).toMatchObject({ kind: 'lobby', ...JOINABLE_LOBBY })
  })

  test('a game being played takes the place of the lobby it started from, and keeps it', () => {
    const activity = getCurrentActivity(
      stateWith({
        lobby: LOBBY,
        gameClient: gameClientIn('game-1', 'playing'),
        participatingGame: GAME,
      }),
    )
    expect(activity).toEqual({
      kind: 'game',
      game: GAME,
      ownSlot: GAME.slots[1],
      lobby: JOINABLE_LOBBY,
    })
  })

  test("a match isn't a lobby's game", () => {
    const activity = getCurrentActivity(
      stateWith({
        lobby: LOBBY,
        gameClient: gameClientIn('game-1', 'playing'),
        participatingGame: { ...GAME, matchmakingType: MatchmakingType.Match1v1 },
      }),
    )
    expect(activity).toMatchObject({ kind: 'game', lobby: undefined })
  })

  test.each(['hasResult', 'resultSent'] as const)('a game counts as played while it %s', state => {
    const activity = getCurrentActivity(
      stateWith({ gameClient: gameClientIn('game-1', state), participatingGame: GAME }),
    )
    expect(activity?.kind).toBe('game')
  })

  test("a game that hasn't started yet, has ended, or isn't the participating one doesn't count", () => {
    for (const gameClient of [
      gameClientIn('game-1', 'configuring'),
      gameClientIn('game-1', 'finished'),
      gameClientIn('game-2', 'playing'),
    ]) {
      expect(getCurrentActivity(stateWith({ gameClient, participatingGame: GAME }))).toBeUndefined()
    }
  })

  test('a replay being played shows with its map', () => {
    const activity = getCurrentActivity(
      stateWith({
        gameClient: watching(['replay-1'], 'playing'),
        watchedReplay: { gameId: 'replay-1', mapName: 'Polypoid' },
      }),
    )
    expect(activity).toEqual({ kind: 'replay', mapName: 'Polypoid' })
  })

  test('a replay other than the one started last shows without a map', () => {
    const activity = getCurrentActivity(
      stateWith({
        gameClient: watching(['replay-1'], 'playing'),
        watchedReplay: { gameId: 'replay-2', mapName: 'Polypoid' },
      }),
    )
    expect(activity).toEqual({ kind: 'replay', mapName: undefined })
  })

  test("a replay that's still loading doesn't count", () => {
    const activity = getCurrentActivity(
      stateWith({
        gameClient: watching(['replay-1'], 'configuring'),
        watchedReplay: { gameId: 'replay-1', mapName: 'Polypoid' },
      }),
    )
    expect(activity).toBeUndefined()
  })

  test('a lobby or a game takes the place of a replay watched at the same time', () => {
    const replay = { gameId: 'replay-1', mapName: 'Polypoid' }
    const watchingReplay = watching(['replay-1'], 'playing')
    expect(
      getCurrentActivity(
        stateWith({ lobby: LOBBY, gameClient: watchingReplay, watchedReplay: replay }),
      )?.kind,
    ).toBe('lobby')
    expect(
      getCurrentActivity(
        stateWith({
          gameClient: { ...gameClientIn('game-1', 'playing'), watchOnly: watchingReplay.watchOnly },
          participatingGame: GAME,
          watchedReplay: replay,
        }),
      )?.kind,
    ).toBe('game')
  })

  test('nothing counts while logged out', () => {
    expect(
      getCurrentActivity(
        stateWith({
          userId: undefined,
          lobby: LOBBY,
          gameClient: gameClientIn('game-1', 'playing'),
          participatingGame: GAME,
        }),
      ),
    ).toBeUndefined()
  })

  test('nothing counts outside a lobby, a game or a replay', () => {
    expect(getCurrentActivity(stateWith({}))).toBeUndefined()
  })
})
