import { useState } from 'react'
import styled from 'styled-components'
import { ReconciledResult } from '../../../common/games/results'
import {
  BestOfSideIndex,
  LobbyBestOfGameJson,
  LobbyBestOfJson,
  LobbyBestOfOutcome,
  LobbyBestOfSideNames,
  LobbyBestOfSides,
} from '../../../common/lobbies/lobby-best-of'
import { LobbySeriesGameJson, LobbySeriesTeamJson } from '../../../common/lobbies/lobby-network'
import { RaceChar } from '../../../common/races'
import { SbUser } from '../../../common/users/sb-user'
import { makeSbUserId, SbUserId } from '../../../common/users/sb-user-id'
import { ReduxAction } from '../../action-types'
import { BigGameHunters, FightingSpirit } from '../../maps/devonly/maps-for-testing'
import { titleMedium } from '../../styles/typography'
import { SeriesResults } from '../room/series-results'
import { SetupPage } from '../setup-page'
import { IsolatedReduxProvider } from './isolated-redux'
import { ScenarioPicker } from './scenario-picker'

// Ids well above the ones a development database hands out, so background user fetches can't
// overwrite these with whoever really holds the low ids.
const FLASH = makeSbUserId(90301)
const JAEDONG = makeSbUserId(90302)
const BISU = makeSbUserId(90303)
const STORK = makeSbUserId(90304)
const JANGBI = makeSbUserId(90305)
const FANTASY = makeSbUserId(90306)
const SOULKEY = makeSbUserId(90307)
const LAST = makeSbUserId(90308)
// Names at the longest an account name can be.
const LONG = [
  makeSbUserId(90311),
  makeSbUserId(90312),
  makeSbUserId(90313),
  makeSbUserId(90314),
  makeSbUserId(90315),
  makeSbUserId(90316),
  makeSbUserId(90317),
  makeSbUserId(90318),
] as const
const LONG_NAMES = [
  'OverlordOfTheCre',
  'CarrierHasArrive',
  'SpawningPoolPart',
  'NuclearLaunchDet',
  'HydraliskDenLord',
  'ZerglingRushHour',
  'PhotonCannonRush',
  'SiegeTankSupreme',
]

const MOCK_USERS: SbUser[] = [
  { id: FLASH, name: 'Flash', created: 0 },
  { id: JAEDONG, name: 'Jaedong', created: 0 },
  { id: BISU, name: 'Bisu', created: 0 },
  { id: STORK, name: 'Stork', created: 0 },
  { id: JANGBI, name: 'Jangbi', created: 0 },
  { id: FANTASY, name: 'Fantasy', created: 0 },
  { id: SOULKEY, name: 'Soulkey', created: 0 },
  { id: LAST, name: 'Last', created: 0 },
  ...LONG.map((id, i) => ({ id, name: LONG_NAMES[i], created: 0 })),
]

const RACES: ReadonlyMap<SbUserId, RaceChar> = new Map<SbUserId, RaceChar>([
  [FLASH, 't'],
  [JAEDONG, 'z'],
  [BISU, 'p'],
  [STORK, 'p'],
  [JANGBI, 'p'],
  [FANTASY, 't'],
  [SOULKEY, 'z'],
  [LAST, 't'],
  ...LONG.map((id, i): [SbUserId, RaceChar] => [id, (['z', 'p', 't', 'r'] as const)[i % 4]]),
])

const SEED_ACTIONS: ReadonlyArray<ReduxAction> = [
  { type: '@users/loadUsers', payload: MOCK_USERS },
  { type: '@maps/loadMapInfos', payload: [FightingSpirit, BigGameHunters] },
]

/** How one entry of a mock series goes. */
type MockPlay =
  | {
      kind: 'game'
      players: LobbyBestOfSides
      /**
       * How the series counts it. `playing` is a game still being played, which has no record yet;
       * `waiting` one that is over with results that haven't settled.
       */
      counts: BestOfSideIndex | 'noWinner' | 'notCounted' | 'waiting' | 'playing'
      /** Set when the host gave the game to `counts` against its own results. */
      setByHost?: boolean
      /** Computers on each side's team. */
      computers?: [RaceChar[], RaceChar[]]
    }
  | { kind: 'added'; winner: BestOfSideIndex }

interface MockSeries {
  bestOf: LobbyBestOfJson
  games: LobbySeriesGameJson[]
  playingGameId?: string
}

/** How a game went for a side by the game's own results, given the side they say won it. */
function ownResult(winner: BestOfSideIndex | undefined, side: BestOfSideIndex): ReconciledResult {
  if (winner === undefined) {
    return 'unknown'
  }
  return winner === side ? 'win' : 'loss'
}

/** Builds a series and its games' records out of how each of its entries went. */
function mockSeries({
  title,
  length,
  playAll,
  sides,
  sideNames,
  plays,
  outcome,
}: {
  title?: string
  length: number
  playAll?: boolean
  sides: LobbyBestOfSides
  sideNames?: LobbyBestOfSideNames
  plays: ReadonlyArray<MockPlay>
  outcome?: LobbyBestOfOutcome
}): MockSeries {
  const entries: LobbyBestOfGameJson[] = []
  const games: LobbySeriesGameJson[] = []
  let playingGameId: string | undefined

  plays.forEach((play, index) => {
    if (play.kind === 'added') {
      entries.push({ resultId: `added-${index}`, status: 'won', winner: play.winner })
      return
    }

    const gameId = `mock-results-game-${index + 1}`
    const { players, counts } = play
    if (counts === 0 || counts === 1) {
      entries.push({
        gameId,
        players,
        status: 'won',
        winner: counts,
        ...(play.setByHost ? { setByHost: true } : {}),
      })
    } else if (counts === 'noWinner' || counts === 'notCounted') {
      entries.push({ gameId, players, status: counts })
    } else {
      entries.push({ gameId, players, status: 'pending' })
    }

    if (counts === 'playing') {
      playingGameId = gameId
      return
    }
    const teams: LobbySeriesTeamJson[] = players.map((side, i) => ({
      teamId: i + 1,
      players: [
        ...side.map(userId => ({
          type: 'human' as const,
          userId,
          race: RACES.get(userId) ?? 'r',
        })),
        ...(play.computers?.[i] ?? []).map(race => ({ type: 'computer' as const, race })),
      ],
    }))
    // The game's own results: a host-set win went the other way by them.
    let ownWinner: BestOfSideIndex | undefined
    if (counts === 0 || counts === 1) {
      ownWinner = play.setByHost ? ((1 - counts) as BestOfSideIndex) : counts
    }
    games.push({
      gameId,
      mapId: index % 3 === 1 ? FightingSpirit.id : BigGameHunters.id,
      teams,
      ...(counts === 'waiting'
        ? {}
        : {
            result: {
              outcomes: players.flatMap((side, i) =>
                side.map(userId => ({
                  userId,
                  result: ownResult(ownWinner, i as BestOfSideIndex),
                })),
              ),
              durationMs: (11 + ((index * 7) % 19)) * 60 * 1000 + ((index * 13) % 60) * 1000,
            },
          }),
    })
  })

  return {
    bestOf: {
      id: 'mock-results',
      ...(title ? { title } : {}),
      length,
      ...(playAll ? { playAll: true } : {}),
      sides,
      ...(sideNames ? { sideNames } : {}),
      games: entries,
      ...(outcome ? { outcome } : {}),
    },
    games,
    ...(playingGameId ? { playingGameId } : {}),
  }
}

const ONE_V_ONE: LobbyBestOfSides = [[FLASH], [JAEDONG]]

type ScenarioId =
  | 'oneVsOne'
  | 'rosters'
  | 'long'
  | 'states'
  | 'computers'
  | 'won'
  | 'drawn'
  | 'endedEarly'
  | 'playAll'
  | 'longNames'
  | 'empty'

const SCENARIOS: ReadonlyArray<{ id: ScenarioId; label: string }> = [
  { id: 'oneVsOne', label: '1v1 · Bo5 · game 4 being played' },
  { id: 'rosters', label: 'Named rosters · pairs change, one moved, one not played' },
  { id: 'long', label: '4v4 · Bo99 · dozens of games' },
  { id: 'states', label: 'Not counted, waiting, host-set win, added result' },
  { id: 'computers', label: '2v2 with computers' },
  { id: 'won', label: 'Won · Final' },
  { id: 'drawn', label: 'Drawn' },
  { id: 'endedEarly', label: 'Ended early' },
  { id: 'playAll', label: '5 games, all played' },
  { id: 'longNames', label: 'Long side + player names' },
  { id: 'empty', label: 'Just started, no games' },
]

function makeScenario(scenario: ScenarioId): MockSeries {
  switch (scenario) {
    case 'oneVsOne':
      return mockSeries({
        title: 'Grand Final',
        length: 5,
        sides: ONE_V_ONE,
        plays: [
          { kind: 'game', players: ONE_V_ONE, counts: 0 },
          { kind: 'game', players: ONE_V_ONE, counts: 1 },
          { kind: 'game', players: ONE_V_ONE, counts: 0 },
          { kind: 'game', players: ONE_V_ONE, counts: 'playing' },
        ],
      })
    case 'rosters':
      // Stork started on side 2 and was moved to side 1 after game 3; Last is on side 2 and has yet
      // to play.
      return mockSeries({
        title: 'Proleague Week 4',
        length: 7,
        sides: [
          [FLASH, BISU, STORK],
          [JAEDONG, FANTASY, SOULKEY, LAST],
        ],
        sideNames: ['KT Rolster', 'SK Telecom T1'],
        plays: [
          {
            kind: 'game',
            players: [
              [FLASH, BISU],
              [JAEDONG, STORK],
            ],
            counts: 0,
          },
          {
            kind: 'game',
            players: [
              [FLASH, BISU],
              [FANTASY, STORK],
            ],
            counts: 1,
          },
          {
            kind: 'game',
            players: [
              [BISU, FLASH],
              [SOULKEY, JAEDONG],
            ],
            counts: 1,
          },
          {
            kind: 'game',
            players: [
              [STORK, FLASH],
              [FANTASY, SOULKEY],
            ],
            counts: 0,
          },
          {
            kind: 'game',
            players: [
              [STORK, BISU],
              [JAEDONG, FANTASY],
            ],
            counts: 0,
          },
        ],
      })
    case 'long': {
      const side1 = LONG.slice(0, 4)
      const side2 = LONG.slice(4)
      const plays: MockPlay[] = []
      for (let i = 0; i < 52; i++) {
        let counts: BestOfSideIndex | 'noWinner' | 'notCounted' = i % 5 < 3 ? 0 : 1
        if (i === 9 || i === 31) {
          counts = 'notCounted'
        } else if (i === 20) {
          counts = 'noWinner'
        }
        plays.push({ kind: 'game', players: [side1, side2], counts })
      }
      plays.push({ kind: 'game', players: [side1, side2], counts: 'playing' })
      return mockSeries({
        title: 'Team League Season Finale: Upper Bracket Decider',
        length: 99,
        sides: [side1, side2],
        sideNames: ['Overlords of the Creep 9', 'Carriers Have Arrived 99'],
        plays,
      })
    }
    case 'states':
      return mockSeries({
        length: 7,
        sides: ONE_V_ONE,
        plays: [
          { kind: 'added', winner: 1 },
          { kind: 'game', players: ONE_V_ONE, counts: 0 },
          { kind: 'game', players: ONE_V_ONE, counts: 'notCounted' },
          { kind: 'game', players: ONE_V_ONE, counts: 1, setByHost: true },
          { kind: 'game', players: ONE_V_ONE, counts: 'noWinner' },
          { kind: 'game', players: ONE_V_ONE, counts: 'waiting' },
        ],
      })
    case 'computers': {
      const players: LobbyBestOfSides = [[BISU], [JAEDONG]]
      return mockSeries({
        title: 'Comp stomp',
        length: 3,
        sides: [
          [BISU, STORK],
          [JAEDONG, SOULKEY],
        ],
        plays: [
          { kind: 'game', players, counts: 0, computers: [['t'], ['z']] },
          {
            kind: 'game',
            players: [
              [BISU, STORK],
              [JAEDONG, SOULKEY],
            ],
            counts: 1,
          },
          { kind: 'game', players, counts: 0, computers: [['p'], ['z']] },
        ],
        outcome: { kind: 'won', winner: 0 },
      })
    }
    case 'won':
      return mockSeries({
        title: 'Grand Final',
        length: 5,
        sides: ONE_V_ONE,
        plays: [
          { kind: 'game', players: ONE_V_ONE, counts: 1 },
          { kind: 'game', players: ONE_V_ONE, counts: 0 },
          { kind: 'game', players: ONE_V_ONE, counts: 0 },
          { kind: 'game', players: ONE_V_ONE, counts: 0 },
        ],
        outcome: { kind: 'won', winner: 0 },
      })
    case 'drawn':
      return mockSeries({
        title: 'Showmatch',
        length: 4,
        sides: [
          [BISU, JANGBI],
          [JAEDONG, SOULKEY],
        ],
        sideNames: ['Protoss', 'Zerg'],
        plays: [
          { kind: 'game', players: [[BISU], [JAEDONG]], counts: 0 },
          { kind: 'game', players: [[JANGBI], [SOULKEY]], counts: 1 },
          { kind: 'game', players: [[BISU], [SOULKEY]], counts: 1 },
          { kind: 'game', players: [[JANGBI], [JAEDONG]], counts: 0 },
        ],
        outcome: { kind: 'drawn' },
      })
    case 'endedEarly':
      return mockSeries({
        length: 5,
        sides: ONE_V_ONE,
        plays: [
          { kind: 'game', players: ONE_V_ONE, counts: 0 },
          { kind: 'game', players: ONE_V_ONE, counts: 1 },
          { kind: 'game', players: ONE_V_ONE, counts: 'notCounted' },
        ],
        outcome: { kind: 'unfinished' },
      })
    case 'playAll':
      return mockSeries({
        length: 5,
        playAll: true,
        sides: ONE_V_ONE,
        plays: [
          { kind: 'game', players: ONE_V_ONE, counts: 0 },
          { kind: 'game', players: ONE_V_ONE, counts: 1 },
          { kind: 'game', players: ONE_V_ONE, counts: 0 },
        ],
      })
    case 'longNames': {
      const side1 = [LONG[0], LONG[1]]
      const side2 = [LONG[2], LONG[3]]
      return mockSeries({
        title: 'An Exceptionally Long Series Title That Hits Fifty',
        length: 3,
        sides: [side1, side2],
        sideNames: ['Overlords of the Creep 9', 'Carriers Have Arrived 99'],
        plays: [
          { kind: 'game', players: [side1, side2], counts: 0 },
          { kind: 'game', players: [side1, side2], counts: 1 },
          { kind: 'game', players: [side1, side2], counts: 0 },
        ],
        outcome: { kind: 'won', winner: 0 },
      })
    }
    case 'empty':
      return mockSeries({ length: 3, sides: ONE_V_ONE, plays: [] })
    default:
      return scenario satisfies never
  }
}

const Container = styled.div`
  width: 100%;
  height: 100%;
  padding: 16px;

  display: grid;
  grid-template-rows: auto 1fr;
  gap: 16px;
`

const Controls = styled.div`
  padding: 16px 0;

  border: 1px solid var(--theme-outline-variant);
  border-radius: 8px;
`

const ControlsTitle = styled.div`
  ${titleMedium};
  margin: 0 16px 8px;
`

/** Stands in for the lobby room, which is at most 1200px wide. */
const RoomFrame = styled.div`
  width: 100%;
  max-width: 1200px;
  min-height: 0;
  margin: 0 auto;

  border: 1px solid var(--theme-outline-variant);
  border-radius: 8px;
  overflow: hidden;
`

export function SeriesResultsTest() {
  const [scenario, setScenario] = useState<ScenarioId>('oneVsOne')
  const { bestOf, games, playingGameId } = makeScenario(scenario)

  return (
    <IsolatedReduxProvider seedActions={SEED_ACTIONS}>
      <Container>
        <Controls>
          <ControlsTitle>Series results</ControlsTitle>
          <ScenarioPicker scenarios={SCENARIOS} active={scenario} onChange={setScenario} />
        </Controls>
        <RoomFrame>
          <SetupPage title='Results' onBack={() => console.log('onBack')}>
            <SeriesResults
              bestOf={bestOf}
              games={games}
              playingGameId={playingGameId}
              onWatchReplay={gameId => console.log('onWatchReplay', gameId)}
              onViewGameSummary={gameId => console.log('onViewGameSummary', gameId)}
            />
          </SetupPage>
        </RoomFrame>
      </Container>
    </IsolatedReduxProvider>
  )
}
