import { render, screen } from '@testing-library/react'
import i18next from 'i18next'
import { initReactI18next } from 'react-i18next'
import { Provider as ReduxProvider } from 'react-redux'
import { beforeAll, describe, expect, test, vi } from 'vitest'
import { GameType } from '../../../common/games/game-type'
import { Lobby } from '../../../common/lobbies'
import { LobbyBestOfJson } from '../../../common/lobbies/lobby-best-of'
import { LobbySeriesGameJson } from '../../../common/lobbies/lobby-network'
import { makeSbLobbyId } from '../../../common/lobbies/sb-lobby-id'
import { createHuman } from '../../../common/lobbies/slot'
import { MapInfo, SbMapId } from '../../../common/maps'
import { SbUser } from '../../../common/users/sb-user'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import createStore from '../../create-store'
import { GameSummaryCard } from './room-chat'

vi.mock('../../maps/map-thumbnail', () => ({ ReduxMapThumbnail: () => null }))

beforeAll(async () => {
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: {}, interpolation: { escapeValue: false } })
})

const ALICE = makeSbUserId(1)
const BOB = makeSbUserId(2)
const USERS: SbUser[] = [
  { id: ALICE, name: 'alice', created: 0 },
  { id: BOB, name: 'bob', created: 0 },
]

const LOBBY: Lobby = {
  id: makeSbLobbyId('lobby'),
  name: 'Lobby',
  map: { id: 'map', name: 'Map', mapData: { slots: 2, umsSlots: 2 } } as unknown as MapInfo,
  mapQueue: [],
  createdAt: 0,
  gameType: GameType.TopVsBottom,
  gameSubType: 1,
  teams: [
    {
      name: 'Top',
      teamId: 1,
      isObserver: false,
      slots: [createHuman(ALICE, 't')],
      hiddenSlots: [],
    },
    {
      name: 'Bottom',
      teamId: 2,
      isObserver: false,
      slots: [createHuman(BOB, 'p')],
      hiddenSlots: [],
    },
  ],
  bench: [],
  host: createHuman(ALICE, 't'),
  useLegacyLimits: false,
  starcraftCompatibleReplays: true,
  lockedAlliances: false,
  visibility: 'listed',
}

/** A finished game that Alice won, by its own results. */
const GAME: LobbySeriesGameJson = {
  gameId: 'g1',
  mapId: 'map' as SbMapId,
  teams: [
    { teamId: 1, players: [{ type: 'human', userId: ALICE, race: 'z' }] },
    { teamId: 2, players: [{ type: 'human', userId: BOB, race: 'p' }] },
  ],
  result: {
    durationMs: 125000,
    outcomes: [
      { userId: ALICE, result: 'win' },
      { userId: BOB, result: 'loss' },
    ],
  },
}

function renderCard(bestOfs: LobbyBestOfJson[]) {
  const store = createStore()
  store.dispatch({ type: '@users/loadUsers', payload: USERS })
  store.dispatch({
    type: '@lobbies/init',
    payload: {
      type: 'init',
      lobby: LOBBY,
      userInfos: USERS,
      readyUsers: [],
      shuffleCount: 0,
      mapStatuses: [],
      series: [GAME],
      bestOfs,
    },
  })
  render(
    <ReduxProvider store={store}>
      <GameSummaryCard gameId='g1' />
    </ReduxProvider>,
  )
}

const SERIES: LobbyBestOfJson = {
  id: 'series',
  length: 3,
  sides: [[ALICE], [BOB]],
  games: [{ gameId: 'g1', players: [[ALICE], [BOB]], status: 'won', winner: 1 }],
}

describe('GameSummaryCard headline', () => {
  test("names the series side that won a series' game, as the room writes a side", () => {
    renderCard([{ ...SERIES, sideNames: ['Nexus', 'Ironclad'] }])
    // The series counts the game for its second side, whatever the game's own results say.
    expect(screen.getByTitle('Game 1: Ironclad won (02:05)')).toBeTruthy()
  })

  test("names an unnamed side by its members' names", () => {
    renderCard([SERIES])
    expect(screen.getByTitle('Game 1: bob won (02:05)')).toBeTruthy()
  })

  test('keeps naming the winning team by the lobby when the series does not count the game', () => {
    renderCard([
      {
        ...SERIES,
        games: [{ gameId: 'g1', players: [[ALICE], [BOB]], status: 'notCounted' }],
      },
    ])
    expect(screen.getByTitle('Game 1: Team 1 won (02:05)')).toBeTruthy()
  })

  test('keeps naming the winning team by the lobby for a game outside a series', () => {
    renderCard([])
    expect(screen.getByTitle('Game 1: Team 1 won (02:05)')).toBeTruthy()
  })
})
