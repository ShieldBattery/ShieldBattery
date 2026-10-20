import { useState } from 'react'
import styled from 'styled-components'
import {
  cacheExchange,
  Client,
  Exchange,
  getOperationName,
  makeErrorResult,
  makeResult,
  Operation,
  Provider as UrqlProvider,
} from 'urql'
import { filter, map, pipe } from 'wonka'
import { mapSlug } from '../../../common/map-url'
import { makeSbMapId, SbMapId, Tileset } from '../../../common/maps'
import { MatchmakingType } from '../../../common/matchmaking'
import { encodePrettyId } from '../../../common/pretty-id'
import { DEFAULT_PERMISSIONS } from '../../../common/users/permissions'
import { SbUser, SelfUserJson } from '../../../common/users/sb-user'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { ReduxAction } from '../../action-types'
import { MapKind } from '../../gql/graphql'
import { IsolatedReduxProvider } from '../../lobbies/devonly/isolated-redux'
import { ScenarioPicker } from '../../lobbies/devonly/scenario-picker'
import { titleMedium } from '../../styles/typography'
import { MapPage } from '../map-page'
import { FightingSpirit } from './maps-for-testing'

// Ids well above the ones a development database hands out, so background user fetches can't
// overwrite these with whoever really holds the low ids.
const VIEWER = makeSbUserId(90030)
const PUBLISHER = makeSbUserId(90031)
const MODERATOR = makeSbUserId(90032)

const USERS: SbUser[] = [
  { id: VIEWER, name: 'devMapViewer', created: 0 },
  { id: PUBLISHER, name: 'tec27_the_sequel', created: 0 },
  { id: MODERATOR, name: 'modMercy', created: 0 },
]

/**
 * A real map in the development database, so the recent games section (which comes from the Node
 * server rather than GraphQL) has games to show for the scenario that uses it.
 */
const DEV_DB_MAP_ID = makeSbMapId('01925c23-983a-77ac-b4fc-58a1b4e88e2e')

const WEEK = 7 * 24 * 60 * 60 * 1000
const DAY = 24 * 60 * 60 * 1000
const NOW = Date.now()

type ScenarioId =
  | 'meleePool'
  | 'fewGames'
  | 'teams'
  | 'ums'
  | 'unlisted'
  | 'delisted'
  | 'neverPlayed'
  | 'noImage'

const SCENARIOS: ReadonlyArray<{ id: ScenarioId; label: string }> = [
  { id: 'meleePool', label: 'Melee pool map' },
  { id: 'fewGames', label: 'Few games' },
  { id: 'teams', label: 'Team compositions' },
  { id: 'ums', label: 'UMS' },
  { id: 'unlisted', label: 'Unlisted' },
  { id: 'delisted', label: 'Delisted' },
  { id: 'neverPlayed', label: 'Never played' },
  { id: 'noImage', label: 'Render fallback' },
]

type ViewerId = 'loggedOut' | 'player' | 'staff'

const VIEWERS: ReadonlyArray<{ id: ViewerId; label: string }> = [
  { id: 'loggedOut', label: 'Logged out' },
  { id: 'player', label: 'Player' },
  { id: 'staff', label: 'Staff' },
]

interface MatchupRow {
  matchup: string
  games: number
  leftWins: number
  rightWins: number
  medianLength: number | null
}

interface Scenario {
  map: Record<string, unknown> & { id: SbMapId; name: string }
  matchups: Partial<Record<MatchmakingType, MatchupRow[]>>
}

function weeklyActivity(id: SbMapId, games: (week: number) => [lobby: number, ranked: number]) {
  const monday = new Date(NOW)
  monday.setUTCHours(0, 0, 0, 0)
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7))
  return Array.from({ length: 26 }, (_, i) => {
    const weekStart = new Date(Number(monday) - (25 - i) * WEEK)
    const [lobbyGames, matchmakingGames] = games(i)
    return {
      id: `${id}:${weekStart.toISOString()}`,
      weekStart: weekStart.toISOString(),
      lobbyGames,
      matchmakingGames,
    }
  })
}

function matchupRow(
  matchup: string,
  leftWins: number,
  rightWins: number,
  medianLength: number | null = 13 * 60 * 1000 + 42 * 1000,
): MatchupRow {
  const games = leftWins + rightWins
  return { matchup, games, leftWins, rightWins, medianLength }
}

function mirror(matchup: string, games: number): MatchupRow {
  return { matchup, games, leftWins: 0, rightWins: 0, medianLength: 12 * 60 * 1000 }
}

function makeMap({
  id,
  name,
  kind = MapKind.Melee,
  playerCount = 4,
  listed = true,
  official = false,
  description = '',
  originalName = name,
  originalDescription = description,
  stats = true,
  activity = (week: number) => [Math.round(8 + week * 1.5), Math.round(20 + 30 * Math.sin(week))],
  matchupSeasons = [],
  umsForces = [
    {
      name: 'Players',
      teamId: 1,
      players: Array.from({ length: playerCount }, (_, i) => ({
        playerId: i,
        isComputer: false,
      })),
    },
  ],
  umsContent = kind === MapKind.Ums,
  baseCount = 12,
  hasImage = true,
  delisted = false,
}: {
  id: SbMapId
  name: string
  kind?: MapKind
  playerCount?: number
  listed?: boolean
  official?: boolean
  description?: string
  originalName?: string
  originalDescription?: string
  stats?: boolean
  activity?: (week: number) => [number, number]
  matchupSeasons?: Array<{ seasonId: number; matchmakingType: MatchmakingType; games: number }>
  umsForces?: Array<{
    name: string
    teamId: number
    players: Array<{ playerId: number; isComputer: boolean }>
  }>
  umsContent?: boolean
  baseCount?: number | null
  hasImage?: boolean
  delisted?: boolean
}): Scenario['map'] {
  const image = (size: 256 | 512 | 1024 | 2048) =>
    hasImage ? (FightingSpirit[`image${size}Url`] ?? '') : ''
  return {
    id,
    name,
    description,
    kind,
    playerCount,
    listed,
    official,
    publishedAt: listed ? new Date(NOW - 200 * DAY).toISOString() : null,
    publisher: listed ? { id: PUBLISHER, name: 'tec27_the_sequel' } : null,
    isFavorited: false,
    inLibrary: !listed,
    favoriteCount: 3,
    stats: stats
      ? {
          id,
          gamesTotal: 18_342,
          games28d: 412,
          players90d: 1_204,
          medianLength90d: 14 * 60 * 1000 + 7 * 1000,
          lastPlayedAt: new Date(NOW - 2 * 60 * 60 * 1000).toISOString(),
        }
      : null,
    weeklyActivity: weeklyActivity(id, stats ? activity : () => [0, 0]),
    matchupSeasons: matchupSeasons.map(s => ({
      id: `${id}:${s.seasonId}:${s.matchmakingType}`,
      ...s,
    })),
    moderation: {
      id,
      delistedAt: delisted ? new Date(NOW - 3 * DAY).toISOString() : null,
      delistedBy: delisted ? { id: MODERATOR, name: 'modMercy' } : null,
    },
    file: {
      id: `${id}-file`,
      image256Url: image(256),
      image512Url: image(512),
      image1024Url: image(1024),
      image2048Url: image(2048),
      imageSpawnsBaked: true,
      width: 128,
      height: 128,
      startLocations: [],
      umsContent,
      originalName,
      originalDescription,
      tileset: Tileset.Jungle,
      isEud: false,
      umsForces,
      analysis: baseCount === null ? null : { id: `${id}-file`, baseCount },
    },
  }
}

const ONE_V_ONE_ROWS: MatchupRow[] = [
  matchupRow('t-z', 412, 389),
  matchupRow('p-z', 371, 352),
  matchupRow('p-t', 298, 331),
  mirror('z-z', 210),
  mirror('t-t', 160),
  mirror('p-p', 122),
]

const SCENARIO_DATA: Record<ScenarioId, () => Scenario> = {
  meleePool: () => ({
    map: makeMap({
      id: DEV_DB_MAP_ID,
      name: 'Fighting Spirit 1.3',
      official: true,
      description: 'The classic 4 player map, as played in the ladder.',
      originalName: '\u0003Fighting \u0004Spirit',
      originalDescription: 'Made by the Korean ladder map makers.',
      matchupSeasons: [
        { seasonId: 7, matchmakingType: MatchmakingType.Match1v1, games: 1300 },
        { seasonId: 6, matchmakingType: MatchmakingType.Match1v1, games: 1150 },
        { seasonId: 7, matchmakingType: MatchmakingType.Match2v2, games: 180 },
      ],
    }),
    matchups: {
      [MatchmakingType.Match1v1]: ONE_V_ONE_ROWS,
      [MatchmakingType.Match2v2]: [
        matchupRow('pt-tz', 31, 24),
        matchupRow('pz-tz', 22, 27),
        matchupRow('pt-pz', 12, 9),
        mirror('tz-tz', 15),
      ],
    },
  }),
  fewGames: () => ({
    map: makeMap({
      id: makeSbMapId('00000000-0000-4000-8000-00000000f001'),
      name: 'Polypoid 1.65',
      playerCount: 2,
      matchupSeasons: [{ seasonId: 7, matchmakingType: MatchmakingType.Match1v1, games: 31 }],
    }),
    matchups: {
      [MatchmakingType.Match1v1]: [
        matchupRow('t-z', 14, 11),
        matchupRow('p-z', 5, 3),
        matchupRow('p-t', 1, 0),
        mirror('z-z', 2),
      ],
    },
  }),
  teams: () => ({
    map: makeMap({
      id: makeSbMapId('00000000-0000-4000-8000-00000000f002'),
      name: 'Hunters KeSPA',
      playerCount: 8,
      matchupSeasons: [
        { seasonId: 7, matchmakingType: MatchmakingType.Match2v2Hunters, games: 400 },
        { seasonId: 7, matchmakingType: MatchmakingType.Match3v3Hunters, games: 90 },
      ],
    }),
    matchups: {
      [MatchmakingType.Match2v2Hunters]: [
        matchupRow('pt-tz', 61, 54),
        matchupRow('pz-tz', 42, 57),
        matchupRow('pt-pz', 33, 29),
        matchupRow('pp-tz', 8, 4),
        mirror('tz-tz', 40),
      ],
      [MatchmakingType.Match3v3Hunters]: [matchupRow('ptz-ptz', 0, 0), matchupRow('ppt-tzz', 9, 6)],
    },
  }),
  ums: () => ({
    map: makeMap({
      id: makeSbMapId('00000000-0000-4000-8000-00000000f003'),
      name: 'Zone Control RPG',
      kind: MapKind.Ums,
      playerCount: 7,
      description: 'Hold the center to win.',
      originalDescription:
        'Pick a hero at the start.\nHold the zones in the middle of the map to earn points.\n' +
        'First team to 100 points wins. The computer sends waves every 2 minutes.',
      umsForces: [
        { name: 'Defender', teamId: 1, players: [{ playerId: 0, isComputer: false }] },
        {
          name: 'Attackers',
          teamId: 2,
          players: Array.from({ length: 6 }, (_, i) => ({ playerId: i + 1, isComputer: false })),
        },
        { name: 'Waves', teamId: 3, players: [{ playerId: 7, isComputer: true }] },
      ],
      baseCount: null,
    }),
    matchups: {},
  }),
  unlisted: () => ({
    map: makeMap({
      id: makeSbMapId('00000000-0000-4000-8000-00000000f004'),
      name: 'my test map v3',
      listed: false,
      description: 'Testing some cliffs',
      activity: week => [week > 20 ? 2 : 0, 0],
    }),
    matchups: {},
  }),
  delisted: () => ({
    map: makeMap({
      id: makeSbMapId('00000000-0000-4000-8000-00000000f005'),
      name: 'Copied Map (stolen)',
      listed: false,
      delisted: true,
      description: 'A copy of a map that was later delisted.',
      activity: week => [week < 10 ? 5 : 0, 0],
    }),
    matchups: {},
  }),
  neverPlayed: () => ({
    map: makeMap({
      id: makeSbMapId('00000000-0000-4000-8000-00000000f006'),
      name: 'Brand New Map',
      stats: false,
      description: 'Uploaded yesterday, nobody has played it yet.',
    }),
    matchups: {},
  }),
  noImage: () => ({
    map: makeMap({
      id: makeSbMapId('00000000-0000-4000-8000-00000000f007'),
      name: 'Unrenderable Map',
      hasImage: false,
      baseCount: null,
      stats: false,
    }),
    matchups: {},
  }),
}

/**
 * Answers the map page's GraphQL operations from a scenario's fixtures, in place of the server.
 */
function fixtureExchange(scenario: Scenario, isStaff: boolean): Exchange {
  const resolve = (operation: Operation): object | undefined => {
    switch (getOperationName(operation.query)) {
      case 'MapPage': {
        const { moderation, ...rest } = scenario.map
        return { map: isStaff ? { ...rest, moderation } : rest }
      }
      case 'MapMatchups': {
        const type = operation.variables?.matchmakingType as MatchmakingType
        const seasonId = (operation.variables?.seasonId ?? null) as number | null
        // A single season shows a slice of the rows, so picking one visibly changes the card.
        const rows = (scenario.matchups[type] ?? []).map(row =>
          seasonId === null
            ? row
            : {
                ...row,
                games: Math.round(row.games / 2),
                leftWins: Math.round(row.leftWins / 2),
                rightWins: Math.round(row.rightWins / 2),
              },
        )
        return {
          map: {
            id: scenario.map.id,
            matchups: rows.map(row => ({
              id: `${scenario.map.id}:${seasonId ?? 'all'}:${type}:${row.matchup}`,
              ...row,
            })),
          },
        }
      }
      case 'MapLiveGames':
        return { liveGames: [] }
      case 'MapPageAddFavorite':
      case 'MapPageRemoveFavorite':
        return undefined
      default:
        return undefined
    }
  }

  return () => operations$ =>
    pipe(
      operations$,
      filter(operation => operation.kind === 'query' || operation.kind === 'mutation'),
      map(operation => {
        const data = resolve(operation)
        return data
          ? makeResult(operation, { data })
          : makeErrorResult(operation, new Error('This dev page has no fixture for this request'))
      }),
    )
}

function seedActions(viewer: ViewerId, scenario: Scenario): ReduxAction[] {
  const actions: ReduxAction[] = [{ type: '@users/loadUsers', payload: USERS }]
  if (viewer !== 'loggedOut') {
    const user: SelfUserJson = {
      id: VIEWER,
      name: 'devMapViewer',
      created: 0,
      loginName: 'devMapViewer',
      email: 'devmapviewer@example.com',
      emailVerified: true,
      acceptedPrivacyVersion: 0,
      acceptedTermsVersion: 0,
      acceptedUsePolicyVersion: 0,
      nameChangeTokens: 0,
    }
    actions.push({
      type: '@auth/loadCurrentSession',
      payload: {
        user,
        permissions: { ...DEFAULT_PERMISSIONS, manageMaps: viewer === 'staff' },
        jwt: '',
      },
    })
  }
  if (scenario.map.official) {
    // Puts the scenario's map in the 1v1 pool, so its ladder pool chip shows.
    actions.push({
      type: '@matchmaking/getCurrentMapPool',
      payload: {
        pool: {
          id: 1,
          matchmakingType: MatchmakingType.Match1v1,
          maps: [scenario.map.id],
          maxVetoCount: 3,
          startDate: NOW - 30 * DAY,
        },
        mapInfos: [],
      },
      meta: { type: MatchmakingType.Match1v1 },
    })
  }
  return actions
}

const Container = styled.div`
  height: 100%;
  overflow: hidden;

  display: flex;
  flex-direction: column;
`

const Controls = styled.div`
  flex-shrink: 0;
  padding: 16px 0;
`

const ControlsTitle = styled.div`
  ${titleMedium};
  margin: 0 16px 8px;
`

const PageContainer = styled.div`
  flex-grow: 1;
  min-height: 0;
  margin: 0 16px 16px;

  display: flex;
  border: 1px solid var(--theme-outline-variant);
  border-radius: 8px;
  overflow: hidden;
`

/**
 * Renders the real map page against fixture data for each of the states it has to handle: the
 * page's GraphQL queries are answered from fixtures, and the viewer is seeded into a page-local
 * Redux store.
 */
export function MapPageTest() {
  const [scenarioId, setScenarioId] = useState<ScenarioId>('meleePool')
  const [viewer, setViewer] = useState<ViewerId>('staff')
  const scenario = SCENARIO_DATA[scenarioId]()
  const client = new Client({
    url: 'http://localhost/devonly-map-page',
    // The document cache keeps a query's result for re-renders that ask for it again, as the app's
    // normalized cache does.
    exchanges: [cacheExchange, fixtureExchange(scenario, viewer === 'staff')],
  })
  const key = `${scenarioId}-${viewer}`

  return (
    <Container>
      <Controls>
        <ControlsTitle>Map page</ControlsTitle>
        <ScenarioPicker scenarios={SCENARIOS} active={scenarioId} onChange={setScenarioId} />
        <ScenarioPicker scenarios={VIEWERS} active={viewer} onChange={setViewer} label='Viewer' />
      </Controls>
      <PageContainer>
        <IsolatedReduxProvider key={key} seedActions={seedActions(viewer, scenario)}>
          <UrqlProvider value={client}>
            <MapPage
              mapId={scenario.map.id}
              idSegment={encodePrettyId(scenario.map.id)}
              slugSegment={mapSlug(scenario.map.name)}
            />
          </UrqlProvider>
        </IsolatedReduxProvider>
      </PageContainer>
    </Container>
  )
}
