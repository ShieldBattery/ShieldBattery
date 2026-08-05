import { createStore, Provider, useStore } from 'jotai'
import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { GameType } from '../../../common/games/game-type'
import { BenchedUser, findSlotById, Lobby, Team } from '../../../common/lobbies'
import { makeSbLobbyId } from '../../../common/lobbies/sb-lobby-id'
import {
  createClosed,
  createComputer,
  createHuman,
  createObserver,
  createOpen,
  Slot,
} from '../../../common/lobbies/slot'
import { MapInfo } from '../../../common/maps'
import { RaceChar } from '../../../common/races'
import { SbUser } from '../../../common/users/sb-user'
import { makeSbUserId, SbUserId } from '../../../common/users/sb-user-id'
import { ReduxAction } from '../../action-types'
import { DispatchFunction } from '../../dispatch-registry'
import { JotaiStore } from '../../jotai-store'
import { BigGameHunters, loadMapsForTesting } from '../../maps/devonly/maps-for-testing'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import { titleMedium } from '../../styles/typography'
import { LobbyRoom } from '../room/lobby-room'
import {
  lobbySeriesAtom,
  LobbySeriesGame,
  LobbySeriesTeam,
  readyUsersAtom,
} from '../room/room-atoms'
import { ScenarioPicker } from './scenario-picker'

type LobbyTestDispatch = DispatchFunction<ReduxAction>

const TEC27 = makeSbUserId(90001)
const PACHI = makeSbUserId(90002)
const DRONEBRO = makeSbUserId(90003)
const SUNN0 = makeSbUserId(90004)
const HEARTCUTTER = makeSbUserId(90005)
const NERDRAGE = makeSbUserId(90006)
const BLUESKY = makeSbUserId(90007)

// Ids well above the ones a development database hands out, so background user fetches can't
// overwrite these with whoever really holds the low ids.
const MOCK_USERS: SbUser[] = [
  { id: TEC27, name: 'tec27_the_sequel', created: 0 },
  { id: PACHI, name: 'Pachi', created: 0 },
  { id: DRONEBRO, name: 'dronebro', created: 0 },
  { id: SUNN0, name: 'sunn0', created: 0 },
  { id: HEARTCUTTER, name: 'HeartcutterXVIII', created: 0 },
  { id: NERDRAGE, name: 'NerdRage', created: 0 },
  { id: BLUESKY, name: 'blueSky', created: 0 },
]

const MOCK_MAP: MapInfo = { ...BigGameHunters, uploadDate: new Date(BigGameHunters.uploadDate) }

type ScenarioId = 'gathering' | 'full' | 'settingsChanged' | 'regroup'
type ViewpointId = 'host' | 'member' | 'benched'

const SCENARIOS: ReadonlyArray<{ id: ScenarioId; label: string }> = [
  { id: 'gathering', label: 'Gathering' },
  { id: 'full', label: 'Gathering · full + bench' },
  { id: 'settingsChanged', label: 'Gathering · setting changed' },
  { id: 'regroup', label: 'Regroup' },
]

const VIEWPOINTS: ReadonlyArray<{ id: ViewpointId; label: string }> = [
  { id: 'host', label: 'Host (tec27_the_sequel)' },
  { id: 'member', label: 'Member (Pachi)' },
  { id: 'benched', label: 'Benched (blueSky)' },
]

const VIEWER_IDS: Record<ViewpointId, SbUserId> = {
  host: TEC27,
  member: PACHI,
  benched: BLUESKY,
}

function makeTeam(name: string, teamId: number, slots: Slot[], isObserver = false): Team {
  return { name, teamId, isObserver, slots, hiddenSlots: [] }
}

function makeBenched(userId: SbUserId, race: RaceChar): BenchedUser {
  return { userId, race, joinedAt: Date.now() - 60 * 1000 }
}

/**
 * Assembles the mock lobby every scenario starts from: a Top vs Bottom 4v4 on an 8-player map, with
 * observer seats and someone waiting on the bench.
 */
function makeLobby(topSlots: Slot[], bottomSlots: Slot[], observers: Slot[]): Lobby {
  return {
    id: makeSbLobbyId('mock-room-lobby'),
    name: 'BGH no-rush 20',
    map: MOCK_MAP,
    createdAt: 1722500000000,
    gameType: GameType.TopVsBottom,
    gameSubType: 4,
    teams: [
      makeTeam('Top', 0, topSlots),
      makeTeam('Bottom', 1, bottomSlots),
      makeTeam('Observers', 2, observers, true),
    ],
    bench: [makeBenched(BLUESKY, 'z')],
    host: topSlots[0],
    useLegacyLimits: false,
    visibility: 'listed',
  }
}

function observerSlots(): Slot[] {
  return [createObserver(NERDRAGE), createOpen(), createOpen(), createOpen()]
}

/** The lobby as it stands before sunn0 turns up, so his arrival can be played out into chat. */
function makeGatheringLobby(): Lobby {
  return makeLobby(
    [createHuman(TEC27, 't'), createHuman(PACHI, 'z'), createOpen(), createOpen()],
    [createHuman(DRONEBRO, 'p'), createHuman(HEARTCUTTER, 'r'), createOpen(), createClosed()],
    observerSlots(),
  )
}

function makeFullLobby(): Lobby {
  return makeLobby(
    [
      createHuman(TEC27, 't'),
      createHuman(PACHI, 'z'),
      createHuman(SUNN0, 'r'),
      createComputer('p'),
    ],
    [
      createHuman(DRONEBRO, 'p'),
      createHuman(HEARTCUTTER, 'r'),
      createComputer('z'),
      createComputer('t'),
    ],
    observerSlots(),
  )
}

/** The lobby after a night of games, with sunn0's seat sitting empty since he left. */
function makeRegroupLobby(): Lobby {
  return makeLobby(
    [createHuman(TEC27, 't'), createHuman(PACHI, 'z'), createOpen(), createClosed()],
    [createHuman(DRONEBRO, 'p'), createHuman(HEARTCUTTER, 'r'), createOpen(), createClosed()],
    observerSlots(),
  )
}

const REGROUP_TEAMS: LobbySeriesTeam[] = [
  {
    name: 'Top',
    players: [
      { userId: TEC27, race: 't' },
      { userId: PACHI, race: 'z' },
      { userId: SUNN0, race: 'r' },
    ],
  },
  {
    name: 'Bottom',
    players: [
      { userId: DRONEBRO, race: 'p' },
      { userId: HEARTCUTTER, race: 'r' },
    ],
  },
]

const REGROUP_SERIES: LobbySeriesGame[] = [
  {
    gameId: 'mock-game-1',
    mapId: BigGameHunters.id,
    winningTeamIndex: 0,
    durationMs: 18 * 60 * 1000 + 22 * 1000,
    teams: REGROUP_TEAMS,
  },
  {
    gameId: 'mock-game-2',
    mapId: BigGameHunters.id,
    winningTeamIndex: 1,
    durationMs: 31 * 60 * 1000 + 7 * 1000,
    teams: REGROUP_TEAMS,
  },
  {
    gameId: 'mock-game-3',
    mapId: BigGameHunters.id,
    winningTeamIndex: 0,
    durationMs: 23 * 60 * 1000 + 41 * 1000,
    teams: REGROUP_TEAMS,
  },
]

function sendMockChat(dispatch: LobbyTestDispatch, from: SbUserId, text: string) {
  dispatch({
    type: '@lobbies/updateChatMessage',
    payload: {
      type: 'chat',
      message: { lobbyName: 'BGH no-rush 20', time: Date.now(), from, text },
      mentions: [],
      channelMentions: [],
    },
  })
}

/**
 * Drives the real lobby reducer through the events that produce a scenario, rather than writing a
 * finished state into it: the chat log, the seating and the callouts all come out of the same
 * handlers the server's events go through.
 */
function seedScenario(dispatch: LobbyTestDispatch, store: JotaiStore, scenario: ScenarioId) {
  dispatch({ type: '@lobbies/updateLeaveSelf' })
  dispatch(loadMapsForTesting())
  dispatch({ type: '@users/loadUsers', payload: MOCK_USERS })

  if (scenario === 'regroup') {
    const lobby = makeRegroupLobby()
    dispatch({ type: '@lobbies/init', payload: { type: 'init', lobby, userInfos: MOCK_USERS } })
    // Plays the night out game by game, so every result lands its own summary card in the log
    // rather than only the last one.
    for (const game of REGROUP_SERIES) {
      dispatch({
        type: '@lobbies/updateGameStarted',
        payload: {
          runState: { gameId: game.gameId, inGameUsers: [], elapsedMs: 0 },
          isParticipant: true,
        },
      })
      dispatch({
        type: '@lobbies/updateRegroup',
        payload: { type: 'regroup', gameId: game.gameId },
      })
    }
    sendMockChat(dispatch, DRONEBRO, 'gg wp. that recall was criminal')
    sendMockChat(dispatch, PACHI, 'one more, loser buys the server a coffee')

    store.set(lobbySeriesAtom, REGROUP_SERIES)
    store.set(readyUsersAtom, new Set<SbUserId>())
    return
  }

  const lobby = scenario === 'full' ? makeFullLobby() : makeGatheringLobby()
  dispatch({ type: '@lobbies/init', payload: { type: 'init', lobby, userInfos: MOCK_USERS } })

  sendMockChat(dispatch, PACHI, "who's bringing the 4th, we need one more for teams")
  sendMockChat(dispatch, DRONEBRO, "invited sunn0, he's installing the patch")

  if (scenario === 'gathering') {
    // Seats sunn0 through the same event a real join arrives on, which also lands his arrival card
    // in the chat log.
    dispatch({
      type: '@lobbies/updateSlotCreate',
      payload: {
        type: 'slotCreate',
        teamIndex: 0,
        slotIndex: 2,
        slot: createHuman(SUNN0, 'r'),
      },
    })
    sendMockChat(dispatch, SUNN0, 'yo. one game then I gotta sleep')
  }

  if (scenario === 'settingsChanged') {
    // A setting change that doesn't restructure the seats, so the notice card landing in chat is
    // the callout treatment rather than the whole layout underneath it.
    dispatch({
      type: '@lobbies/updateSettingsChange',
      payload: {
        type: 'settingsChange',
        changedSettings: ['useLegacyLimits'],
        lobby: { ...lobby, useLegacyLimits: true },
      },
    })
  }

  sendMockChat(dispatch, PACHI, '"one game" — famous last words')

  store.set(lobbySeriesAtom, [])
  // A settings change resets ready states, so that scenario shows only the host re-readied.
  store.set(
    readyUsersAtom,
    scenario === 'settingsChanged'
      ? new Set([TEC27])
      : new Set([TEC27, PACHI, HEARTCUTTER, NERDRAGE]),
  )
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

const RoomContainer = styled.div`
  min-height: 0;

  border: 1px solid var(--theme-outline-variant);
  border-radius: 8px;
  overflow: hidden;
`

const testStore = createStore()

export function LobbyRoomTest() {
  return (
    <Provider store={testStore}>
      <LobbyRoomTestInner />
    </Provider>
  )
}

function LobbyRoomTestInner() {
  const dispatch = useAppDispatch()
  const store = useStore()
  const [scenario, setScenario] = useState<ScenarioId>('gathering')
  const [viewpoint, setViewpoint] = useState<ViewpointId>('host')

  const viewerId = VIEWER_IDS[viewpoint]

  // The connection lifecycle empties the lobby reducer (see '@network/connect' in
  // lobby-reducer.ts), and the site socket can connect after this page has already seeded — so
  // reseed whenever the seeded lobby disappears, not just when the scenario changes.
  const seeded = useAppSelector(s => !!s.lobby.info.name)
  const lastSeededScenario = useRef<ScenarioId | undefined>(undefined)
  useEffect(() => {
    if (!seeded || lastSeededScenario.current !== scenario) {
      lastSeededScenario.current = scenario
      seedScenario(dispatch, store, scenario)
    }
  }, [dispatch, store, scenario, seeded])

  // Ticks a started countdown down so the pre-launch state reads the way it will in a real lobby.
  const countdownTimer = useAppSelector(s =>
    s.lobby.loadingState.isCountingDown ? s.lobby.loadingState.countdownTimer : undefined,
  )
  useEffect(() => {
    if (countdownTimer === undefined || countdownTimer <= 0) {
      return () => {}
    }

    const timeout = setTimeout(() => {
      dispatch({ type: '@lobbies/updateCountdownTick', payload: countdownTimer - 1 })
    }, 1000)
    return () => clearTimeout(timeout)
  }, [countdownTimer, dispatch])

  const lobby = useAppSelector(s => s.lobby.info)

  return (
    <Container>
      <Controls>
        <ControlsTitle>Lobby room</ControlsTitle>
        <ScenarioPicker scenarios={SCENARIOS} active={scenario} onChange={setScenario} />
        <ScenarioPicker
          label='Viewpoint'
          scenarios={VIEWPOINTS}
          active={viewpoint}
          onChange={setViewpoint}
        />
      </Controls>

      <RoomContainer>
        {lobby.name ? (
          <LobbyRoom
            viewerId={viewerId}
            onSendChatMessage={text => sendMockChat(dispatch, viewerId, text)}
            onSetRace={(slotId, race) => {
              const [teamIndex, slotIndex] = findSlotById(lobby, slotId)
              if (teamIndex !== undefined && slotIndex !== undefined) {
                dispatch({
                  type: '@lobbies/updateRaceChange',
                  payload: { type: 'raceChange', teamIndex, slotIndex, newRace: race },
                })
              }
            }}
            onSitInSlot={slotId => console.log('onSitInSlot', slotId)}
            onToggleReady={() => {
              const readyUsers = new Set(store.get(readyUsersAtom))
              if (readyUsers.has(viewerId)) {
                readyUsers.delete(viewerId)
              } else {
                readyUsers.add(viewerId)
              }
              store.set(readyUsersAtom, readyUsers)
            }}
            onStartGame={() => dispatch({ type: '@lobbies/updateCountdownStart', payload: 5 })}
            onForceStart={() => dispatch({ type: '@lobbies/updateCountdownStart', payload: 5 })}
            onCancelCountdown={() => dispatch({ type: '@lobbies/updateCountdownCanceled' })}
            onOpenGameSetup={() => console.log('onOpenGameSetup')}
            onSlotAction={(action, slotId) => console.log('onSlotAction', action, slotId)}
            onArrangeTeams={arrangement => console.log('onArrangeTeams', arrangement)}
            onWatchReplay={gameId => console.log('onWatchReplay', gameId)}
            onViewGameSummary={gameId => console.log('onViewGameSummary', gameId)}
          />
        ) : null}
      </RoomContainer>
    </Container>
  )
}
