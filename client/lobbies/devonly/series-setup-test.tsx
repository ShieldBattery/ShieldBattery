import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { GameType } from '../../../common/games/game-type'
import { Lobby, Team } from '../../../common/lobbies'
import {
  BestOfDisplayName,
  getRunningBestOf,
  LobbyBestOfJson,
  LobbyBestOfLogoJson,
  toBestOfOverlayJson,
} from '../../../common/lobbies/lobby-best-of'
import {
  GetRememberedBestOfOverlayResponse,
  LobbyServiceErrorCode,
} from '../../../common/lobbies/lobby-network'
import { makeSbLobbyId } from '../../../common/lobbies/sb-lobby-id'
import { createHuman, createObserver, createOpen, Slot } from '../../../common/lobbies/slot'
import { MapInfo } from '../../../common/maps'
import { DEFAULT_PERMISSIONS } from '../../../common/users/permissions'
import { SbUser } from '../../../common/users/sb-user'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { ReduxAction } from '../../action-types'
import { BigGameHunters, loadMapsForTesting } from '../../maps/devonly/maps-for-testing'
import { FilledButton } from '../../material/button'
import { RequestHandlingSpec } from '../../network/abortable-thunk'
import { FetchError } from '../../network/fetch-errors'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { bodyMedium, labelMedium, titleMedium } from '../../styles/typography'
import { StartBestOfParams, UpdateBestOfParams } from '../action-creators'
import { BestOfLogoSlot } from '../room/best-of-logo-slot'
import { RoomSeriesSetup } from '../room/room-series-setup'
import { logoFileProblemMessage, LogoSlotValue } from '../room/series-setup'
import { IsolatedReduxProvider } from './isolated-redux'
import { applyMockBestOfNames } from './mock-best-of-names'
import { ScenarioPicker } from './scenario-picker'
import { SQUARE_LOGO, WIDE_LOGO } from './series-setup-samples'

// Ids well above the ones a development database hands out, so background user fetches can't
// overwrite these with whoever really holds the low ids.
const HOST = makeSbUserId(90101)
const ALLY = makeSbUserId(90102)
const RIVAL_1 = makeSbUserId(90103)
const RIVAL_2 = makeSbUserId(90104)
const OBSERVER = makeSbUserId(90105)
const BENCHED = makeSbUserId(90106)
// The roster of a team league side, most of them waiting on the bench or observing.
const ROSTER = [
  makeSbUserId(90107),
  makeSbUserId(90108),
  makeSbUserId(90109),
  makeSbUserId(90110),
  makeSbUserId(90111),
  makeSbUserId(90112),
] as const
const ROSTER_NAMES = [
  'OverlordOfTheCre',
  'Spawning_Pool_99',
  'HydraliskDen',
  'zergling.rush',
  'NydusWorm',
  'DefilerMound',
]

const MOCK_USERS: SbUser[] = [
  { id: HOST, name: 'claude-2', created: 0 },
  { id: ALLY, name: 'claude-4', created: 0 },
  { id: RIVAL_1, name: 'claude-3', created: 0 },
  { id: RIVAL_2, name: 'claude-5', created: 0 },
  { id: OBSERVER, name: 'NerdRage', created: 0 },
  { id: BENCHED, name: 'blueSky', created: 0 },
  ...ROSTER.map((id, i) => ({ id, name: ROSTER_NAMES[i], created: 0 })),
]

/** The display names the mock host is remembered to have given people in an earlier series. */
const REMEMBERED_NAMES: ReadonlyArray<BestOfDisplayName> = [
  { userId: HOST, name: 'Rhynso' },
  { userId: RIVAL_2, name: 'Artosis' },
  { userId: BENCHED, name: 'Bisu' },
  { userId: ROSTER[1], name: '이영호' },
]

const MOCK_MAP: MapInfo = { ...BigGameHunters, uploadDate: new Date(BigGameHunters.uploadDate) }

type ScenarioId =
  | 'newSeries'
  | 'remembered'
  | 'running'
  | 'rememberedLoading'
  | 'rememberedFailed'
  | 'rememberedNames'
  | 'runningNamed'
  | 'eightOnASide'
  | 'namesFailed'
  | 'logoSlots'
type ServerAnswerId = 'accept' | 'refuseRoster' | 'refuseLogo' | 'refuseTooBig' | 'throttled'

const SCENARIOS: ReadonlyArray<{ id: ScenarioId; label: string }> = [
  { id: 'newSeries', label: 'New series' },
  { id: 'remembered', label: 'New lobby · remembered lines + logo' },
  { id: 'running', label: 'Running series · Bo7 at 2–1' },
  { id: 'rememberedLoading', label: 'Remembered · loading' },
  { id: 'rememberedFailed', label: 'Remembered · failed to load' },
  { id: 'rememberedNames', label: 'New series · remembered display names' },
  { id: 'runningNamed', label: 'Running · named sides + display names' },
  { id: 'eightOnASide', label: 'Running · eight on a side, long names' },
  { id: 'namesFailed', label: 'Remembered display names · failed to load' },
  { id: 'logoSlots', label: 'Logo slot states' },
]

const SERVER_ANSWERS: ReadonlyArray<{ id: ServerAnswerId; label: string }> = [
  { id: 'accept', label: 'Accept' },
  { id: 'refuseRoster', label: 'Refuse · InvalidBestOf' },
  { id: 'refuseLogo', label: 'Refuse · BestOfLogoInappropriate' },
  { id: 'refuseTooBig', label: 'Refuse · 413 too big' },
  { id: 'throttled', label: 'Refuse · 429 throttled' },
]

function makeTeam(name: string, teamId: number, slots: Slot[], isObserver = false): Team {
  return { name, teamId, isObserver, slots, hiddenSlots: [] }
}

/**
 * A 2v2 with its seats already forming the two sides, an observer and someone on the bench. A
 * crowded lobby also has a team league roster spread over the observer seats and the bench.
 */
function makeLobby(crowded = false): Lobby {
  const hostSlot = createHuman(HOST, 't')
  return {
    id: makeSbLobbyId('mock-series-lobby'),
    name: 'Nexus Cup finals',
    map: MOCK_MAP,
    mapQueue: [],
    createdAt: 1722500000000,
    gameType: GameType.TopVsBottom,
    gameSubType: 2,
    teams: [
      makeTeam('Top', 1, [hostSlot, createHuman(ALLY, 'z')]),
      makeTeam('Bottom', 2, [createHuman(RIVAL_1, 'p'), createHuman(RIVAL_2, 'r')]),
      makeTeam(
        'Observers',
        0,
        crowded
          ? [createObserver(OBSERVER), createObserver(ROSTER[0]), createObserver(ROSTER[1])]
          : [createObserver(OBSERVER), createOpen()],
        true,
      ),
    ],
    bench: [BENCHED, ...(crowded ? ROSTER.slice(2) : [])].map(userId => ({
      userId,
      race: 'z' as const,
      joinedAt: Date.now() - 60 * 1000,
    })),
    host: hostSlot,
    useLegacyLimits: false,
    starcraftCompatibleReplays: true,
    lockedAlliances: false,
    visibility: 'listed',
  }
}

const RUNNING_BEST_OF: LobbyBestOfJson = {
  id: 'mock-running-best-of',
  title: 'Grand Final',
  length: 7,
  sides: [
    [HOST, ALLY],
    [RIVAL_1, RIVAL_2],
  ],
  games: [
    { gameId: 'mock-game-1', status: 'won', winner: 0 },
    { gameId: 'mock-game-2', status: 'won', winner: 1 },
    { gameId: 'mock-game-3', status: 'won', winner: 0 },
  ],
  overlay: {
    line1: 'Casters  Nyoken & Day9',
    line2: 'Observer  Royo',
    logo: WIDE_LOGO,
  },
}

const RUNNING_NAMED_BEST_OF: LobbyBestOfJson = {
  ...RUNNING_BEST_OF,
  id: 'mock-running-named-best-of',
  sides: [
    [HOST, ALLY],
    [RIVAL_1, RIVAL_2, BENCHED],
  ],
  sideNames: ['Nexus Esports', 'Ironclad'],
  displayNames: [
    { userId: ALLY, name: 'Flash' },
    { userId: RIVAL_1, name: 'tec27' },
  ],
}

/** A full side of eight, with names as long as they can be. */
const EIGHT_ON_A_SIDE_BEST_OF: LobbyBestOfJson = {
  ...RUNNING_BEST_OF,
  id: 'mock-eight-on-a-side-best-of',
  title: 'Team League Season Finale: Upper Bracket',
  sides: [
    [HOST, ALLY, ...ROSTER],
    [RIVAL_1, RIVAL_2, OBSERVER],
  ],
  sideNames: ['Overlords of the Creep 9', 'Ironclad'],
  displayNames: [
    { userId: ALLY, name: 'Sixteen_Chars_Ok' },
    { userId: ROSTER[0], name: '최고의저그플레이어' },
    { userId: RIVAL_1, name: 'tec27' },
  ],
}

function scenarioBestOfs(scenario: ScenarioId): LobbyBestOfJson[] {
  switch (scenario) {
    case 'running':
      return [RUNNING_BEST_OF]
    case 'runningNamed':
      return [RUNNING_NAMED_BEST_OF]
    case 'eightOnASide':
      return [EIGHT_ON_A_SIDE_BEST_OF]
    default:
      return []
  }
}

const REMEMBERED: GetRememberedBestOfOverlayResponse = {
  line1: 'Casters  Nyoken & Day9',
  line2: 'Observer  Royo',
  logo: SQUARE_LOGO,
}

const SEED_ACTIONS: ReadonlyArray<ReduxAction> = [
  {
    type: '@auth/loadCurrentSession',
    payload: {
      user: {
        id: HOST,
        name: 'claude-2',
        created: 0,
        loginName: 'claude-2',
        email: 'claude-2@example.com',
        emailVerified: true,
        acceptedPrivacyVersion: 0,
        acceptedTermsVersion: 0,
        acceptedUsePolicyVersion: 0,
        acceptedRulesVersion: 0,
        nameChangeTokens: 0,
      },
      permissions: { ...DEFAULT_PERMISSIONS },
      jwt: '',
    },
  },
]

/** Seeds the page-local store with the lobby (and its running series, if the scenario has one). */
function seedScenario(dispatch: ReturnType<typeof useAppDispatch>, scenario: ScenarioId) {
  dispatch({ type: '@lobbies/updateLeaveSelf' })
  dispatch(loadMapsForTesting())
  dispatch({ type: '@users/loadUsers', payload: MOCK_USERS })
  dispatch({
    type: '@lobbies/init',
    payload: {
      type: 'init',
      lobby: makeLobby(scenario === 'eightOnASide' || scenario === 'rememberedNames'),
      userInfos: MOCK_USERS,
      readyUsers: [],
      shuffleCount: 0,
      mapStatuses: [],
      series: [],
      bestOfs: scenarioBestOfs(scenario),
    },
  })
}

/** The error the server answers a refused start or save with. */
function makeRefusal(answer: Exclude<ServerAnswerId, 'accept'>): FetchError {
  const [status, code] = {
    refuseRoster: [400, LobbyServiceErrorCode.InvalidBestOf],
    refuseLogo: [400, LobbyServiceErrorCode.BestOfLogoInappropriate],
    refuseTooBig: [413, 'MaxFileSizeExceeded'],
    throttled: [429, undefined],
  }[answer] as [number, string | undefined]
  return new FetchError(
    new Response(null, { status, statusText: 'Refused' }),
    code ? JSON.stringify({ code }) : '',
  )
}

/** What a logo request leaves a mock series with, the way the server applies it. */
function applyLogo(
  current: LobbyBestOfLogoJson | undefined,
  { logo, deleteLogo }: Pick<StartBestOfParams, 'logo' | 'deleteLogo'>,
): LobbyBestOfLogoJson | undefined {
  if (logo) {
    return { url: URL.createObjectURL(logo), fileName: logo.name }
  }
  return deleteLogo ? undefined : current
}

/** Describes a request the page sent, for the log on this page. */
function describeRequest(kind: string, { logo, ...rest }: StartBestOfParams | UpdateBestOfParams) {
  return `${kind} ${JSON.stringify({ ...rest, ...(logo ? { logo: `<file ${logo.name}>` } : {}) })}`
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

const RequestLog = styled.div`
  ${bodyMedium};
  margin: 12px 16px 0;
  font-family: monospace;
  overflow-wrap: anywhere;
  color: var(--theme-on-surface-variant);
`

const PageContainer = styled.div`
  min-height: 0;

  border: 1px solid var(--theme-outline-variant);
  border-radius: 8px;
  overflow: hidden;
`

const ClosedState = styled.div`
  ${bodyMedium};
  height: 100%;

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
`

const SlotGallery = styled.div`
  padding: 24px;

  display: grid;
  grid-template-columns: repeat(2, minmax(0, 420px));
  gap: 32px 48px;
`

const SlotCaption = styled.div`
  ${labelMedium};
  margin-bottom: 8px;
  color: var(--theme-on-surface-variant);
`

export function SeriesSetupTest() {
  return (
    <IsolatedReduxProvider seedActions={SEED_ACTIONS}>
      <SeriesSetupTestInner />
    </IsolatedReduxProvider>
  )
}

function SeriesSetupTestInner() {
  const dispatch = useAppDispatch()
  const [scenario, setScenario] = useState<ScenarioId>('newSeries')
  const [serverAnswer, setServerAnswer] = useState<ServerAnswerId>('accept')
  const [isOpen, setIsOpen] = useState(true)
  const [openCount, setOpenCount] = useState(0)
  const [lastRequest, setLastRequest] = useState<string>()

  // The page-local store starts out empty, so it's seeded on mount. A scenario change reseeds it in
  // the same click, before the page remounts, since the page settles whether it starts or edits a
  // series from the lobby as it stands when it mounts.
  const hasSeeded = useRef(false)
  useEffect(() => {
    if (!hasSeeded.current) {
      hasSeeded.current = true
      seedScenario(dispatch, 'newSeries')
    }
  }, [dispatch])

  const lobbyName = useAppSelector(s => s.lobby.info.name)
  const runningBestOf = useAppSelector(s => getRunningBestOf(s.lobby.bestOfs))

  const reopen = () => {
    setIsOpen(true)
    setOpenCount(count => count + 1)
  }

  const answer = (spec: RequestHandlingSpec<void>, onAccepted: () => void) => {
    setTimeout(() => {
      if (serverAnswer === 'accept') {
        onAccepted()
        spec.onSuccess()
      } else {
        spec.onError(makeRefusal(serverAnswer))
      }
    }, 600)
  }

  let page: React.ReactNode
  if (scenario === 'logoSlots') {
    page = <LogoSlotGallery />
  } else if (!lobbyName) {
    page = null
  } else if (!isOpen) {
    page = (
      <ClosedState>
        <span>Back in the room.</span>
        <FilledButton label='Open the series page again' onClick={reopen} />
      </ClosedState>
    )
  } else {
    page = (
      <RoomSeriesSetup
        key={`${scenario}-${openCount}`}
        onClose={() => setIsOpen(false)}
        onLoadRememberedOverlay={spec => {
          if (scenario === 'rememberedLoading') {
            return
          }
          setTimeout(() => {
            if (spec.signal?.aborted) {
              return
            }
            if (scenario === 'rememberedFailed') {
              spec.onError(new Error('mock remembered overlay failure'))
            } else {
              spec.onSuccess(
                scenario === 'remembered' || scenario === 'rememberedNames' ? REMEMBERED : {},
              )
            }
          }, 400)
        }}
        onLoadRememberedDisplayNames={(userIds, spec) => {
          if (scenario === 'rememberedLoading') {
            return
          }
          setTimeout(() => {
            if (spec.signal?.aborted) {
              return
            }
            if (scenario === 'namesFailed') {
              spec.onError(new Error('mock remembered display names failure'))
            } else {
              spec.onSuccess({
                displayNames: REMEMBERED_NAMES.filter(entry => userIds.includes(entry.userId)),
              })
            }
          }, 400)
        }}
        onStartBestOf={(request, spec) => {
          setLastRequest(describeRequest('start', request))
          answer(spec, () => {
            const started: LobbyBestOfJson = {
              id: `mock-started-best-of-${openCount}`,
              ...(request.title ? { title: request.title } : {}),
              length: request.length,
              sides: request.sides,
              games: [],
              overlay: toBestOfOverlayJson({
                line1: request.line1,
                line2: request.line2,
                logo: applyLogo(scenario === 'remembered' ? REMEMBERED.logo : undefined, request),
              }),
            }
            const bestOf = applyMockBestOfNames(started, request, 'start')
            dispatch({
              type: '@lobbies/updateBestOfStarted',
              payload: { type: 'bestOfStarted', bestOf },
            })
          })
        }}
        onUpdateBestOf={(request, spec) => {
          setLastRequest(describeRequest('update', request))
          answer(spec, () => {
            if (!runningBestOf) {
              return
            }
            const overlay = runningBestOf.overlay ?? {}
            const updated: LobbyBestOfJson = {
              ...runningBestOf,
              ...(request.sides ? { sides: request.sides } : {}),
              overlay: toBestOfOverlayJson({
                line1: request.line1 === undefined ? overlay.line1 : (request.line1 ?? undefined),
                line2: request.line2 === undefined ? overlay.line2 : (request.line2 ?? undefined),
                logo: applyLogo(overlay.logo, request),
              }),
            }
            if (request.title !== undefined) {
              delete updated.title
              if (request.title) {
                updated.title = request.title
              }
            }
            const bestOf = applyMockBestOfNames(updated, request, 'update')
            dispatch({
              type: '@lobbies/updateBestOfUpdated',
              payload: { type: 'bestOfUpdated', bestOf },
            })
          })
        }}
        onEndBestOf={() => {
          setLastRequest('end')
          if (runningBestOf) {
            dispatch({
              type: '@lobbies/updateBestOfEnded',
              payload: {
                type: 'bestOfEnded',
                bestOf: { ...runningBestOf, outcome: { kind: 'unfinished' } },
              },
            })
          }
        }}
      />
    )
  }

  return (
    <Container>
      <Controls>
        <ControlsTitle>Series setup page</ControlsTitle>
        <ScenarioPicker
          scenarios={SCENARIOS}
          active={scenario}
          onChange={id => {
            seedScenario(dispatch, id)
            setScenario(id)
            setIsOpen(true)
            setLastRequest(undefined)
          }}
        />
        <ScenarioPicker
          label='Server answers start / save with'
          scenarios={SERVER_ANSWERS}
          active={serverAnswer}
          onChange={setServerAnswer}
        />
        <RequestLog data-testid='series-setup-dev-last-request'>
          Last request: {lastRequest ?? '(none)'}
        </RequestLog>
      </Controls>

      <PageContainer>{page}</PageContainer>
    </Container>
  )
}

/** The logo slot in each of its states, side by side. */
function LogoSlotGallery() {
  const { t } = useTranslation()
  const slots: ReadonlyArray<{ caption: string; value: LogoSlotValue; error?: string }> = [
    { caption: 'Empty', value: { kind: 'none' } },
    { caption: 'Square emblem (light artwork)', value: { kind: 'stored', logo: SQUARE_LOGO } },
    { caption: 'Wide wordmark (dark artwork)', value: { kind: 'stored', logo: WIDE_LOGO } },
    {
      caption: 'Refused file',
      value: { kind: 'none' },
      error: logoFileProblemMessage({ kind: 'dimensions', width: 2048, height: 512 }, t),
    },
    {
      caption: 'Remembered logo failed to load',
      value: { kind: 'unknown' },
    },
    { caption: 'Loading', value: { kind: 'unknown' } },
  ]

  return (
    <SlotGallery>
      {slots.map((slot, i) => (
        <div key={slot.caption}>
          <SlotCaption>{slot.caption}</SlotCaption>
          <BestOfLogoSlot
            value={slot.value}
            loading={i === slots.length - 1}
            error={slot.error}
            onPick={file => console.log('onPick', file)}
            onRefuse={message => console.log('onRefuse', message)}
            onRemove={() => console.log('onRemove')}
          />
        </div>
      ))}
    </SlotGallery>
  )
}
