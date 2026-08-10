import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { GameType } from '../../../common/games/game-type'
import {
  LobbyPreviewJson,
  LobbySummaryJson,
  LobbySummarySlotJson,
  LobbySummaryTeamJson,
} from '../../../common/lobbies/lobby-network'
import { makeSbLobbyId, SbLobbyId } from '../../../common/lobbies/sb-lobby-id'
import { MapInfoJson } from '../../../common/maps'
import { RaceChar } from '../../../common/races'
import { DEFAULT_PERMISSIONS } from '../../../common/users/permissions'
import { UserRelationshipKind } from '../../../common/users/relationships'
import { SbUser, SelfUserJson } from '../../../common/users/sb-user'
import { makeSbUserId, SbUserId } from '../../../common/users/sb-user-id'
import { ReduxAction } from '../../action-types'
import { DispatchFunction } from '../../dispatch-registry'
import {
  BigGameHunters,
  FightingSpirit,
  loadMapsForTesting,
} from '../../maps/devonly/maps-for-testing'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { titleMedium } from '../../styles/typography'
import { LobbyBrowser } from '../browser/lobby-browser'
import { IsolatedReduxProvider } from './isolated-redux'
import { ScenarioPicker } from './scenario-picker'

type BrowserTestDispatch = DispatchFunction<ReduxAction>

// Ids well above the ones a development database hands out, so background user fetches can't
// overwrite these with whoever really holds the low ids.
const VIEWER = makeSbUserId(90020)
const TEC27 = makeSbUserId(90001)
const PACHI = makeSbUserId(90002)
const DRONEBRO = makeSbUserId(90003)
const SUNN0 = makeSbUserId(90004)
const HEARTCUTTER = makeSbUserId(90005)
const NERDRAGE = makeSbUserId(90006)
const BLUESKY = makeSbUserId(90007)
const KOALA = makeSbUserId(90008)
const MERCY = makeSbUserId(90009)

const MOCK_USERS: SbUser[] = [
  { id: TEC27, name: 'tec27_the_sequel', created: 0 },
  { id: PACHI, name: 'Pachi', created: 0 },
  { id: DRONEBRO, name: 'dronebro', created: 0 },
  { id: SUNN0, name: 'sunn0', created: 0 },
  { id: HEARTCUTTER, name: 'HeartcutterXVIII', created: 0 },
  { id: NERDRAGE, name: 'NerdRage', created: 0 },
  { id: BLUESKY, name: 'blueSky', created: 0 },
  { id: KOALA, name: 'koalaSmash', created: 0 },
  { id: MERCY, name: 'mercyRule', created: 0 },
]

/** The two people the viewer is friends with, so friend stacks and callouts have something to show. */
const FRIENDS: SbUserId[] = [PACHI, DRONEBRO]

const VIEWER_USER: SelfUserJson = {
  id: VIEWER,
  name: 'devBrowser',
  created: 0,
  loginName: 'devBrowser',
  email: 'devbrowser@example.com',
  emailVerified: true,
  acceptedPrivacyVersion: 0,
  acceptedTermsVersion: 0,
  acceptedUsePolicyVersion: 0,
  nameChangeTokens: 0,
}

const SEED_ACTIONS: ReadonlyArray<ReduxAction> = [
  // The browser only opens its subscriptions while the socket is up, and this page stands in for
  // what those subscriptions would deliver.
  { type: '@network/connect' },
  {
    type: '@auth/loadCurrentSession',
    payload: { user: VIEWER_USER, permissions: { ...DEFAULT_PERMISSIONS }, jwt: '' },
  },
]

const MINUTE = 60 * 1000

function open(): LobbySummarySlotJson {
  return { type: 'open' }
}
function closed(): LobbySummarySlotJson {
  return { type: 'closed' }
}
function human(userId: SbUserId, race: RaceChar): LobbySummarySlotJson {
  return { type: 'human', userId, race }
}
function computer(race: RaceChar): LobbySummarySlotJson {
  return { type: 'computer', race }
}
function observer(userId: SbUserId): LobbySummarySlotJson {
  return { type: 'observer', userId }
}

function team(name: string, slots: LobbySummarySlotJson[]): LobbySummaryTeamJson {
  return { name, isObserver: false, slots }
}

function observerTeam(slots: LobbySummarySlotJson[]): LobbySummaryTeamJson {
  return { name: 'Observers', isObserver: true, slots }
}

interface SummarySpec {
  id: string
  name: string
  map: MapInfoJson
  gameType: GameType
  gameSubType?: number
  host: SbUserId
  teams: LobbySummaryTeamJson[]
  useLegacyLimits?: boolean
  /** How many members wait on the bench for a seat. */
  benchCount?: number
  /** Minutes ago the lobby was created. */
  ageMinutes: number
}

/** Tallies a spec's seats the way the server does before it puts a lobby on the wire. */
function slotCounts(teams: ReadonlyArray<LobbySummaryTeamJson>) {
  const playerSlots = { taken: 0, total: 0, open: 0 }
  const observerSlots = { taken: 0, open: 0 }
  const occupantIds: SbUserId[] = []

  for (const t of teams) {
    for (const slot of t.slots) {
      if (slot.type === 'human' || slot.type === 'observer') {
        occupantIds.push(slot.userId)
      }

      if (t.isObserver) {
        if (slot.type === 'observer') observerSlots.taken += 1
        else if (slot.type === 'open') observerSlots.open += 1
      } else {
        playerSlots.total += 1
        if (slot.type === 'human' || slot.type === 'computer') playerSlots.taken += 1
        else if (slot.type === 'open') playerSlots.open += 1
      }
    }
  }

  return {
    playerSlots,
    observerSlots,
    hasObserverTeam: teams.some(t => t.isObserver),
    occupantIds,
  }
}

function makePreview(spec: SummarySpec): LobbyPreviewJson {
  return {
    id: makeSbLobbyId(spec.id),
    name: spec.name,
    map: spec.map,
    gameType: spec.gameType,
    gameSubType: spec.gameSubType ?? 0,
    host: { id: spec.host },
    useLegacyLimits: spec.useLegacyLimits ?? false,
    ...slotCounts(spec.teams),
    benchCount: spec.benchCount ?? 0,
    createdAt: Date.now() - spec.ageMinutes * MINUTE,
    teams: spec.teams,
  }
}

/** Drops the slot layout, leaving exactly what the public list channel carries. */
function toSummary({ teams, ...summary }: LobbyPreviewJson): LobbySummaryJson {
  return summary
}

/** A full evening: every game type and occupancy the browser has to render. */
function busyEveningLobbies(): LobbyPreviewJson[] {
  return [
    makePreview({
      id: 'browser-bgh-norush',
      name: 'BGH no-rush 20',
      map: BigGameHunters,
      gameType: GameType.Melee,
      host: TEC27,
      ageMinutes: 12,
      teams: [
        team('', [
          human(TEC27, 't'),
          human(PACHI, 'z'),
          human(KOALA, 'p'),
          computer('r'),
          open(),
          open(),
          open(),
          closed(),
        ]),
      ],
    }),
    makePreview({
      id: 'browser-ums-poker',
      name: 'UMS night — poker defense',
      map: FightingSpirit,
      gameType: GameType.UseMapSettings,
      host: MERCY,
      ageMinutes: 45,
      teams: [
        team('Players', [
          human(MERCY, 't'),
          human(SUNN0, 'z'),
          human(HEARTCUTTER, 'p'),
          human(NERDRAGE, 'r'),
        ]),
      ],
    }),
    makePreview({
      id: 'browser-sq-scrims',
      name: 'clan sQ scrims',
      map: BigGameHunters,
      gameType: GameType.TopVsBottom,
      gameSubType: 4,
      host: BLUESKY,
      ageMinutes: 20,
      teams: [
        team('Top', [human(BLUESKY, 'z'), human(KOALA, 't'), human(SUNN0, 'p'), human(MERCY, 'r')]),
        team('Bottom', [
          human(HEARTCUTTER, 't'),
          human(NERDRAGE, 'z'),
          human(TEC27, 'p'),
          human(PACHI, 'r'),
        ]),
        observerTeam([observer(DRONEBRO), open(), closed(), closed()]),
      ],
    }),
    makePreview({
      id: 'browser-1v1-practice',
      name: 'pvz practice, be nice',
      map: FightingSpirit,
      gameType: GameType.OneVsOne,
      host: SUNN0,
      ageMinutes: 3,
      teams: [team('', [human(SUNN0, 'p'), open()])],
    }),
    makePreview({
      id: 'browser-observers',
      name: 'showmatch — obs welcome',
      map: FightingSpirit,
      gameType: GameType.Melee,
      host: NERDRAGE,
      ageMinutes: 30,
      teams: [
        team('', [human(NERDRAGE, 't'), human(DRONEBRO, 'z'), open(), open()]),
        observerTeam([open(), open(), closed(), closed()]),
      ],
    }),
    makePreview({
      id: 'browser-rush-hour',
      name: 'rush hour',
      map: FightingSpirit,
      gameType: GameType.Melee,
      host: MERCY,
      ageMinutes: 6,
      teams: [
        team('', [human(MERCY, 't'), human(BLUESKY, 'z'), human(KOALA, 'p'), human(SUNN0, 'r')]),
      ],
    }),
  ]
}

function quietLobbies(): LobbyPreviewJson[] {
  return [
    makePreview({
      id: 'browser-quiet',
      name: 'anyone up for a game',
      map: FightingSpirit,
      gameType: GameType.Melee,
      host: TEC27,
      ageMinutes: 2,
      teams: [team('', [human(TEC27, 'r'), open(), open(), open()])],
    }),
  ]
}

/** Nothing joinable: the list is empty until Show full is on, then everything is a dead end. */
function allFullLobbies(): LobbyPreviewJson[] {
  return [
    makePreview({
      id: 'browser-full-1',
      name: 'packed house',
      map: FightingSpirit,
      gameType: GameType.Melee,
      host: TEC27,
      benchCount: 2,
      ageMinutes: 14,
      teams: [team('', [human(TEC27, 't'), human(PACHI, 'z'), human(KOALA, 'p'), computer('r')])],
    }),
    makePreview({
      id: 'browser-full-2',
      name: 'no room at the inn',
      map: BigGameHunters,
      gameType: GameType.TopVsBottom,
      gameSubType: 4,
      host: MERCY,
      ageMinutes: 22,
      teams: [
        team('Top', [
          human(MERCY, 'z'),
          human(SUNN0, 't'),
          human(NERDRAGE, 'p'),
          human(BLUESKY, 'r'),
        ]),
        team('Bottom', [
          human(HEARTCUTTER, 'z'),
          human(DRONEBRO, 't'),
          human(KOALA, 'p'),
          computer('r'),
        ]),
      ],
    }),
  ]
}

type ScenarioId = 'busyEvening' | 'quiet' | 'empty' | 'allFull'

const SCENARIOS: ReadonlyArray<{ id: ScenarioId; label: string }> = [
  { id: 'busyEvening', label: 'Busy evening' },
  { id: 'quiet', label: 'Quiet night (1 lobby)' },
  { id: 'empty', label: 'Nothing hosted' },
  { id: 'allFull', label: 'All full' },
]

function scenarioPreviews(scenario: ScenarioId): LobbyPreviewJson[] {
  switch (scenario) {
    case 'busyEvening':
      return busyEveningLobbies()
    case 'quiet':
      return quietLobbies()
    case 'empty':
      return []
    case 'allFull':
      return allFullLobbies()
    default:
      return scenario satisfies never
  }
}

/**
 * Fills the page-local store with the state the real browser reads: the maps, the people, the
 * viewer's friendships, and the lobby list itself — pushed through the same `listUpdate` action the
 * `/lobbies` channel publishes.
 *
 * Returns the scenario's full previews keyed by lobby id, so the page can answer the browser's
 * preview subscription the way that lobby's own channel would.
 */
function seedScenario(
  dispatch: BrowserTestDispatch,
  scenario: ScenarioId,
): Map<SbLobbyId, LobbyPreviewJson> {
  dispatch(loadMapsForTesting())
  dispatch({ type: '@users/loadUsers', payload: MOCK_USERS })
  dispatch({
    type: '@users/getRelationships',
    payload: {
      summary: {
        friends: FRIENDS.map(toId => ({
          fromId: VIEWER,
          toId,
          kind: UserRelationshipKind.Friend,
          createdAt: 0,
        })),
        incomingRequests: [],
        outgoingRequests: [],
        blocks: [],
      },
      users: MOCK_USERS,
    },
  })

  const previews = scenarioPreviews(scenario)
  dispatch({
    type: '@lobbies/listUpdate',
    payload: { message: 'full', data: previews.map(toSummary) },
  })
  dispatch({ type: '@lobbies/countUpdate', payload: { count: previews.length } })

  return new Map(previews.map(preview => [preview.id, preview]))
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

const BrowserContainer = styled.div`
  min-height: 0;
  padding: 0 16px;

  border: 1px solid var(--theme-outline-variant);
  border-radius: 8px;
  overflow: hidden;
`

export function LobbyBrowserTest() {
  return (
    <IsolatedReduxProvider seedActions={SEED_ACTIONS}>
      <LobbyBrowserTestInner />
    </IsolatedReduxProvider>
  )
}

function LobbyBrowserTestInner() {
  const dispatch = useAppDispatch()
  const [scenario, setScenario] = useState<ScenarioId>('busyEvening')
  const previewLobbyId = useAppSelector(s => s.lobbyList.previewLobbyId)

  // The page-local store starts out empty, so seed on mount and reseed when the scenario changes.
  const previewsRef = useRef<Map<SbLobbyId, LobbyPreviewJson>>(new Map())
  const lastSeededScenario = useRef<ScenarioId | undefined>(undefined)
  useEffect(() => {
    if (lastSeededScenario.current !== scenario) {
      lastSeededScenario.current = scenario
      previewsRef.current = seedScenario(dispatch, scenario)
    }
  }, [dispatch, scenario])

  // Stands in for the lobby's preview channel: whichever lobby the browser subscribes to gets its
  // slot layout back, so the rail's roster fills in the way it does against a real server.
  useEffect(() => {
    const preview =
      previewLobbyId !== undefined ? previewsRef.current.get(previewLobbyId) : undefined
    if (preview) {
      dispatch({ type: '@lobbies/previewUpdate', payload: preview })
    }
  }, [dispatch, previewLobbyId])

  return (
    <Container>
      <Controls>
        <ControlsTitle>Lobby browser</ControlsTitle>
        <ScenarioPicker scenarios={SCENARIOS} active={scenario} onChange={setScenario} />
      </Controls>

      <BrowserContainer>
        <LobbyBrowser onNavigateToCreate={() => console.log('onNavigateToCreate')} />
      </BrowserContainer>
    </Container>
  )
}
