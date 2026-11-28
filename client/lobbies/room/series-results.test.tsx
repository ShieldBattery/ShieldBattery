import { fireEvent, render, screen, within } from '@testing-library/react'
import i18next from 'i18next'
import { LazyMotion } from 'motion/react'
import { initReactI18next } from 'react-i18next'
import { Provider as ReduxProvider } from 'react-redux'
import { beforeAll, describe, expect, test, vi } from 'vitest'
import { LobbyBestOfJson } from '../../../common/lobbies/lobby-best-of'
import { LobbySeriesGameJson } from '../../../common/lobbies/lobby-network'
import { SbMapId } from '../../../common/maps'
import { SbUser } from '../../../common/users/sb-user'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import createStore from '../../create-store'
import { domMax } from '../../motion-features'
import { SeriesResults } from './series-results'

beforeAll(async () => {
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: {}, interpolation: { escapeValue: false } })
})

const ALICE = makeSbUserId(1)
const BOB = makeSbUserId(2)
const CAROL = makeSbUserId(3)
const USERS: SbUser[] = [
  { id: ALICE, name: 'alice', created: 0 },
  { id: BOB, name: 'bob', created: 0 },
  { id: CAROL, name: 'carol', created: 0 },
]

const MAP = 'map' as SbMapId

function record(gameId: string): LobbySeriesGameJson {
  return {
    gameId,
    mapId: MAP,
    teams: [
      { teamId: 1, players: [{ type: 'human', userId: ALICE, race: 't' }] },
      { teamId: 2, players: [{ type: 'human', userId: BOB, race: 'z' }] },
    ],
    result: {
      outcomes: [
        { userId: ALICE, result: 'win' },
        { userId: BOB, result: 'loss' },
      ],
      durationMs: 600000,
    },
  }
}

/** Alice against Bob, with Carol on Alice's side yet to play. */
const SERIES: LobbyBestOfJson = {
  id: 'series',
  length: 3,
  sides: [[ALICE, CAROL], [BOB]],
  games: [
    { gameId: 'g1', players: [[ALICE], [BOB]], status: 'won', winner: 0 },
    { gameId: 'g2', players: [[ALICE], [BOB]], status: 'notCounted' },
  ],
}

function renderResults(
  bestOf: LobbyBestOfJson,
  {
    onWatchReplay = () => {},
    onViewGameSummary = () => {},
  }: { onWatchReplay?: (id: string) => void; onViewGameSummary?: (id: string) => void } = {},
) {
  const store = createStore()
  store.dispatch({ type: '@users/loadUsers', payload: USERS })
  return render(
    <ReduxProvider store={store}>
      <LazyMotion features={domMax}>
        <SeriesResults
          bestOf={bestOf}
          games={[record('g1'), record('g2')]}
          onWatchReplay={onWatchReplay}
          onViewGameSummary={onViewGameSummary}
        />
      </LazyMotion>
    </ReduxProvider>,
  )
}

describe('SeriesResults', () => {
  test('lists the roster of a side of several, and none for a side of one', () => {
    renderResults(SERIES)
    expect(screen.getByTestId('series-results-roster-1')).toBeTruthy()
    expect(screen.queryByTestId('series-results-roster-2')).toBeNull()
  })

  test('says a member who has not played has not played yet', () => {
    renderResults(SERIES)
    expect(screen.getByTestId(`series-results-member-1-${CAROL}`).textContent).toBe(
      'Not played yet',
    )
    expect(screen.getByTestId(`series-results-member-1-${ALICE}`).textContent).toBe('W')
  })

  test('marks the sides with W and L only once the series is won', () => {
    const { unmount } = renderResults(SERIES)
    expect(screen.queryByTestId('series-results-side-1-result')).toBeNull()
    expect(screen.queryByTestId('series-results-side-2-result')).toBeNull()
    unmount()

    renderResults({
      ...SERIES,
      games: [
        ...SERIES.games,
        { gameId: 'g3', players: [[ALICE], [BOB]], status: 'won', winner: 0 },
      ],
      outcome: { kind: 'won', winner: 0 },
    })
    expect(screen.getByTestId('series-results-side-1-result').textContent).toBe('W')
    expect(screen.getByTestId('series-results-side-2-result').textContent).toBe('L')
    expect(screen.getByTestId('series-results-state').textContent).toBe('Best of 3 · Final')
  })

  test('marks nobody when the series ended early', () => {
    renderResults({ ...SERIES, outcome: { kind: 'unfinished' } })
    expect(screen.queryByTestId('series-results-side-1-result')).toBeNull()
    expect(screen.getByTestId('series-results-state').textContent).toBe('Best of 3 · Ended early')
  })

  test('gives a game that did not count no chips', () => {
    renderResults(SERIES)
    const counted = screen.getByTestId('series-results-game-g1')
    const notCounted = screen.getByTestId('series-results-game-g2')
    expect(within(counted).getAllByRole('img', { name: /Win|Loss/ })).toHaveLength(2)
    expect(within(notCounted).queryAllByRole('img', { name: /Win|Loss/ })).toHaveLength(0)
    expect(notCounted.textContent).toContain('Not counted')
  })

  test('opens the replay and summary of a game by its id', () => {
    const onWatchReplay = vi.fn()
    const onViewGameSummary = vi.fn()
    renderResults(SERIES, { onWatchReplay, onViewGameSummary })

    fireEvent.click(screen.getByTestId('series-results-replay-g2'))
    fireEvent.click(screen.getByTestId('series-results-summary-g1'))
    expect(onWatchReplay).toHaveBeenCalledWith('g2')
    expect(onViewGameSummary).toHaveBeenCalledWith('g1')
  })
})
