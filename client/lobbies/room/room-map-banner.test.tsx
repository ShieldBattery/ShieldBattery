import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import i18next from 'i18next'
import { LazyMotion } from 'motion/react'
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
import { makeSbUserId, SbUserId } from '../../../common/users/sb-user-id'
import createStore from '../../create-store'
import { domMax } from '../../motion-features'
import { BestOfScoreTile } from './best-of-score-tile'
import { BestOfStandings } from './lobby-scoreboard'
import { RoomMapBanner } from './room-map-banner'

vi.mock('../../maps/action-creators', () => ({ batchGetMapInfo: () => () => {} }))
vi.mock('../../maps/map-thumbnail', () => ({ ReduxMapThumbnail: () => null }))
vi.mock('../../maps/map-image', () => ({ MapInfoImage: () => null }))

beforeAll(async () => {
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: {}, interpolation: { escapeValue: false } })
})

const ALICE = makeSbUserId(1)
const BOB = makeSbUserId(2)
const CAROL = makeSbUserId(3)
const DAVE = makeSbUserId(4)
const USERS: SbUser[] = [
  { id: ALICE, name: 'Pachi', created: 0 },
  { id: BOB, name: 'dronebro', created: 0 },
  { id: CAROL, name: 'carol', created: 0 },
  { id: DAVE, name: 'dave', created: 0 },
]

const LOBBY: Lobby = {
  id: makeSbLobbyId('lobby'),
  name: 'Lobby',
  map: {
    id: 'map',
    name: 'Map',
    mapData: { slots: 2, umsSlots: 2, width: 128, height: 128, tileset: 0 },
  } as unknown as MapInfo,
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

function finishedGame(
  gameId: string,
  teams: SbUserId[][],
  winners: SbUserId[],
): LobbySeriesGameJson {
  return {
    gameId,
    mapId: 'map' as SbMapId,
    teams: teams.map((players, index) => ({
      teamId: index + 1,
      players: players.map(userId => ({ type: 'human' as const, userId, race: 'z' as const })),
    })),
    result: {
      durationMs: 125000,
      outcomes: teams.flat().map(userId => ({
        userId,
        result: winners.includes(userId) ? ('win' as const) : ('loss' as const),
      })),
    },
  }
}

function makeStore(series: LobbySeriesGameJson[], bestOfs: LobbyBestOfJson[]) {
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
      series,
      bestOfs,
    },
  })
  return store
}

/**
 * Reads a row of results the way it reads out: each result chip as its name in brackets, followed
 * by what the chip marks.
 */
function readResults(element: HTMLElement): string {
  const copy = element.cloneNode(true) as HTMLElement
  for (const chip of Array.from(copy.querySelectorAll('[role=img]'))) {
    chip.replaceWith(`[${chip.getAttribute('aria-label')}]`)
  }
  return copy.textContent ?? ''
}

function renderBanner(
  store: ReturnType<typeof makeStore>,
  onOpenSeriesResults: (bestOfId: string) => void = () => {},
) {
  render(
    <ReduxProvider store={store}>
      <LazyMotion features={domMax}>
        <RoomMapBanner
          viewerId={ALICE}
          onArrangeTeams={() => {}}
          onOpenSeriesSetup={() => {}}
          onOpenSeriesResults={onOpenSeriesResults}
          onEndBestOf={() => {}}
          onDiscardBestOfGame={() => {}}
          onWatchReplay={() => {}}
          onViewGameSummary={() => {}}
        />
      </LazyMotion>
    </ReduxProvider>,
  )
  fireEvent.click(screen.getByRole('button', { name: /All games/ }))
}

const DUEL_SERIES: LobbyBestOfJson = {
  id: 'duel',
  length: 3,
  sides: [[ALICE], [BOB]],
  games: [
    { gameId: 'g1', players: [[ALICE], [BOB]], status: 'won', winner: 1 },
    { gameId: 'g2', players: [[ALICE], [BOB]], status: 'noWinner' },
  ],
}

describe('RoomMapBanner games list', () => {
  test('names a one against one game of a series winner first, each after its result chip', () => {
    const series = [
      finishedGame('g1', [[ALICE], [BOB]], [ALICE]),
      finishedGame('g2', [[ALICE], [BOB]], []),
    ]
    renderBanner(makeStore(series, [DUEL_SERIES]))

    const rows = screen.getAllByTestId('series-game-row')
    // The series counts the game for Bob, whatever the game's own results say.
    expect(readResults(within(rows[0]).getByTestId('series-game-result'))).toBe(
      '[Win]dronebro[Loss]Pachi',
    )
    expect(within(rows[0]).getByText('02:05')).toBeTruthy()
    // A game that didn't count keeps its wording and has no chip.
    expect(readResults(within(rows[1]).getByTestId('series-game-result'))).toBe('Not counted')
  })

  test('names the winning side of a team game of a series after a win chip', () => {
    const bestOf: LobbyBestOfJson = {
      id: 'teams',
      length: 3,
      sides: [
        [ALICE, CAROL],
        [BOB, DAVE],
      ],
      sideNames: ['Nexus Esports', null],
      games: [
        {
          gameId: 'g1',
          players: [
            [ALICE, CAROL],
            [BOB, DAVE],
          ],
          status: 'won',
          winner: 0,
        },
      ],
    }
    const series = [
      finishedGame(
        'g1',
        [
          [ALICE, CAROL],
          [BOB, DAVE],
        ],
        [ALICE, CAROL],
      ),
    ]
    renderBanner(makeStore(series, [bestOf]))

    expect(readResults(screen.getByTestId('series-game-result'))).toBe('[Win]Nexus Esports')
  })

  test('names the winner of a plain one against one game first', () => {
    renderBanner(makeStore([finishedGame('g1', [[ALICE], [BOB]], [BOB])], []))

    expect(readResults(screen.getByTestId('series-game-result'))).toBe('[Win]dronebro[Loss]Pachi')
  })

  test('opens the full results of a series from its heading and closes the list', async () => {
    const onOpenSeriesResults = vi.fn()
    renderBanner(
      makeStore([finishedGame('g1', [[ALICE], [BOB]], [BOB])], [DUEL_SERIES]),
      onOpenSeriesResults,
    )

    fireEvent.click(screen.getByText('Full results'))

    expect(onOpenSeriesResults).toHaveBeenCalledWith('duel')
    await waitFor(() => expect(screen.queryByText('Full results')).toBeNull())
  })
})

describe('series result chips', () => {
  const WON: LobbyBestOfJson = {
    ...DUEL_SERIES,
    games: [
      { gameId: 'g1', players: [[ALICE], [BOB]], status: 'won', winner: 0 },
      { gameId: 'g2', players: [[ALICE], [BOB]], status: 'won', winner: 0 },
    ],
  }
  const ENDED_EARLY: LobbyBestOfJson = { ...WON, outcome: { kind: 'unfinished' } }
  const SERIES_WON: LobbyBestOfJson = { ...WON, outcome: { kind: 'won', winner: 0 } }
  const DRAWN: LobbyBestOfJson = { ...WON, outcome: { kind: 'drawn' } }

  function chipsOf(testId: string) {
    return Array.from(screen.getByTestId(testId).querySelectorAll('[role=img]')).map(chip =>
      chip.getAttribute('aria-label'),
    )
  }

  test.each([
    ['running', DUEL_SERIES, [], []],
    ['ended early', ENDED_EARLY, [], []],
    ['won', SERIES_WON, ['Win'], ['Loss']],
    ['drawn', DRAWN, ['Draw'], ['Draw']],
  ])('the score tile of a series that is %s', (_name, bestOf, first, second) => {
    render(
      <ReduxProvider store={makeStore([], [bestOf])}>
        <LazyMotion features={domMax}>
          <BestOfScoreTile bestOf={bestOf} />
        </LazyMotion>
      </ReduxProvider>,
    )

    expect(chipsOf('best-of-score-row-1')).toEqual(first)
    expect(chipsOf('best-of-score-row-2')).toEqual(second)
  })

  test.each([
    ['running', DUEL_SERIES, 0],
    ['ended early', ENDED_EARLY, 0],
    ['won', SERIES_WON, 2],
    ['drawn', DRAWN, 2],
  ])('the standings of a series that is %s', (_name, bestOf, chipCount) => {
    const { container } = render(
      <ReduxProvider store={makeStore([], [bestOf])}>
        <BestOfStandings bestOf={bestOf} />
      </ReduxProvider>,
    )

    expect(container.querySelectorAll('[role=img]')).toHaveLength(chipCount)
  })
})
