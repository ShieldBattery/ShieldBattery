import { act, render, screen } from '@testing-library/react'
import i18next from 'i18next'
import { LazyMotion } from 'motion/react'
import { initReactI18next } from 'react-i18next'
import { Provider as ReduxProvider } from 'react-redux'
import { beforeAll, describe, expect, test } from 'vitest'
import { GameType } from '../../../common/games/game-type'
import { Lobby, Team } from '../../../common/lobbies'
import { LobbyBestOfJson } from '../../../common/lobbies/lobby-best-of'
import { makeSbLobbyId } from '../../../common/lobbies/sb-lobby-id'
import { createHuman, createObserver, createOpen, Slot } from '../../../common/lobbies/slot'
import { MapInfo } from '../../../common/maps'
import { SbUser } from '../../../common/users/sb-user'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import createStore from '../../create-store'
import { domMax } from '../../motion-features'
import { BestOfEndedLine, BestOfStartedLine } from './best-of-chat-lines'
import { useBestOfSideLabel } from './best-of-parts'
import { BestOfScoreTile } from './best-of-score-tile'

beforeAll(async () => {
  await i18next
    .use(initReactI18next)
    .init({ lng: 'en', resources: {}, interpolation: { escapeValue: false } })
})

const ALICE = makeSbUserId(1)
const BOB = makeSbUserId(2)
const CAROL = makeSbUserId(3)
const DAVE = makeSbUserId(4)
const ERIN = makeSbUserId(5)
const USERS: SbUser[] = [
  { id: ERIN, name: 'erin', created: 0 },
  { id: ALICE, name: 'alice', created: 0 },
  { id: BOB, name: 'bob', created: 0 },
  { id: CAROL, name: 'carol', created: 0 },
  { id: DAVE, name: 'dave', created: 0 },
]

function makeTeam(name: string, teamId: number, slots: Slot[], isObserver = false): Team {
  return { name, teamId, isObserver, slots, hiddenSlots: [] }
}

/** Alice and Bob seated against each other, Carol observing and Dave on the bench. */
function makeLobby(top: Slot[] = [createHuman(ALICE, 't')]): Lobby {
  return {
    id: makeSbLobbyId('lobby'),
    name: 'Lobby',
    map: { id: 'map', name: 'Map', mapData: { slots: 2, umsSlots: 2 } } as unknown as MapInfo,
    mapQueue: [],
    createdAt: 0,
    gameType: GameType.TopVsBottom,
    gameSubType: 1,
    teams: [
      makeTeam('Top', 1, top),
      makeTeam('Bottom', 2, [createHuman(BOB, 'p')]),
      makeTeam('Observers', 0, [createObserver(CAROL), createOpen()], true),
    ],
    bench: [{ userId: DAVE, race: 'z', joinedAt: 0 }],
    host: top[0],
    useLegacyLimits: false,
    starcraftCompatibleReplays: true,
    lockedAlliances: false,
    visibility: 'listed',
  }
}

const SERIES: LobbyBestOfJson = {
  id: 'series',
  length: 3,
  sides: [
    [CAROL, ALICE, DAVE],
    [BOB, ERIN],
  ],
  games: [{ gameId: 'g1', status: 'won', winner: 0 }],
}

function makeStore(lobby: Lobby, bestOfs: LobbyBestOfJson[]) {
  const store = createStore()
  store.dispatch({ type: '@users/loadUsers', payload: USERS })
  store.dispatch({
    type: '@lobbies/init',
    payload: {
      type: 'init',
      lobby,
      userInfos: USERS,
      readyUsers: [],
      shuffleCount: 0,
      mapStatuses: [],
      series: [],
      bestOfs,
    },
  })
  return store
}

function renderWithStore(store: ReturnType<typeof makeStore>, element: React.ReactNode) {
  return render(
    <ReduxProvider store={store}>
      <LazyMotion features={domMax}>{element}</LazyMotion>
    </ReduxProvider>,
  )
}

function SideLabel({ name }: { name?: string }) {
  return <span data-testid='label'>{useBestOfSideLabel([ALICE, BOB], name)}</span>
}

describe('useBestOfSideLabel', () => {
  test("labels a side by its name, or by its members' account names without one", () => {
    const store = makeStore(makeLobby(), [])
    const { rerender } = renderWithStore(store, <SideLabel />)
    expect(screen.getByTestId('label').textContent).toBe('alice, bob')

    rerender(
      <ReduxProvider store={store}>
        <SideLabel name='Ironclad' />
      </ReduxProvider>,
    )
    expect(screen.getByTestId('label').textContent).toBe('Ironclad')
  })
})

describe('BestOfScoreTile', () => {
  test('a named side lists its members seated as players; an unnamed one keeps the first and +N', () => {
    const bestOf: LobbyBestOfJson = { ...SERIES, sideNames: ['Nexus', null] }
    renderWithStore(makeStore(makeLobby(), [bestOf]), <BestOfScoreTile bestOf={bestOf} />)

    expect(screen.getByTestId('best-of-score-row-1').textContent).toBe('Nexusalice1')
    expect(screen.getByTestId('best-of-score-seated-1').textContent).toBe('alice')
    expect(screen.getByTestId('best-of-score-row-2').textContent).toBe('bob+10')
    expect(screen.queryByTestId('best-of-score-seated-2')).toBeNull()
  })

  test('keeps the line, empty, while nobody of a named side is seated', () => {
    const bestOf: LobbyBestOfJson = { ...SERIES, sideNames: ['Nexus', 'Ironclad'] }
    const store = makeStore(makeLobby([createOpen()]), [bestOf])
    renderWithStore(store, <BestOfScoreTile bestOf={bestOf} />)

    expect(screen.getByTestId('best-of-score-seated-1').textContent).toBe('')
    expect(screen.getByTestId('best-of-score-seated-2').textContent).toBe('bob')
  })

  test('drops the line once the series is over', () => {
    const bestOf: LobbyBestOfJson = {
      ...SERIES,
      sideNames: ['Nexus', null],
      outcome: { kind: 'unfinished' },
    }
    renderWithStore(makeStore(makeLobby(), [bestOf]), <BestOfScoreTile bestOf={bestOf} />)

    expect(screen.queryByTestId('best-of-score-seated-1')).toBeNull()
  })
})

describe('series chat lines', () => {
  test('follow a rename of the series they are about, and fall back to the members', () => {
    const store = makeStore(makeLobby(), [])
    act(() => {
      store.dispatch({
        type: '@lobbies/updateBestOfStarted',
        payload: { type: 'bestOfStarted', bestOf: { ...SERIES, sideNames: [null, 'Ironclad'] } },
      })
    })
    renderWithStore(
      store,
      <>
        <div data-testid='started'>
          <BestOfStartedLine bestOfId='series' length={3} sides={[[ALICE], [BOB]]} />
        </div>
        <div data-testid='ended'>
          <BestOfEndedLine
            bestOfId='series'
            sides={[[ALICE], [BOB]]}
            score={[2, 0]}
            outcome={{ kind: 'won', winner: 0 }}
          />
        </div>
      </>,
    )
    expect(screen.getByTestId('started').textContent).toBe(
      'Series started: Best of 3 · alice vs Ironclad',
    )
    expect(screen.getByTestId('ended').textContent).toBe('alice won the series 2–0')

    act(() => {
      store.dispatch({
        type: '@lobbies/updateBestOfUpdated',
        payload: { type: 'bestOfUpdated', bestOf: { ...SERIES, sideNames: ['Nexus', 'Iron'] } },
      })
    })
    expect(screen.getByTestId('started').textContent).toBe(
      'Series started: Best of 3 · Nexus vs Iron',
    )
    expect(screen.getByTestId('ended').textContent).toBe('Nexus won the series 2–0')
  })

  test('name the sides of their own series in a lobby that has run several', () => {
    const first: LobbyBestOfJson = {
      ...SERIES,
      id: 'first',
      sideNames: ['Old', null],
      outcome: { kind: 'unfinished' },
    }
    const second: LobbyBestOfJson = { ...SERIES, id: 'second', sideNames: ['New', null] }
    renderWithStore(
      makeStore(makeLobby(), [first, second]),
      <>
        <div data-testid='first'>
          <BestOfStartedLine bestOfId='first' length={3} sides={[[ALICE], [BOB]]} />
        </div>
        <div data-testid='second'>
          <BestOfStartedLine bestOfId='second' length={3} sides={[[ALICE], [BOB]]} />
        </div>
      </>,
    )
    expect(screen.getByTestId('first').textContent).toBe('Series started: Best of 3 · Old vs bob')
    expect(screen.getByTestId('second').textContent).toBe('Series started: Best of 3 · New vs bob')
  })
})
