import { ReadonlyDeep } from 'type-fest'
import { getErrorStack } from '../../common/errors'
import { GameType } from '../../common/games/game-type'
import { TypedIpcRenderer } from '../../common/ipc'
import { LobbyVisibility } from '../../common/lobbies'
import {
  ChangeLobbySourceRequest,
  CreateLobbyRequest,
  CreateLobbyResponse,
  GetLobbyStateResponse,
  JoinLobbyRequest,
  LobbyClientRequest,
  LobbyNetworkParams,
  LobbyPreferencesResponse,
  LobbySlotRequest,
  MoveSlotRequest,
  SendLobbyChatRequest,
  SendLobbyOutcomeRequest,
  SetLobbyRaceRequest,
  SetLobbyReadyRequest,
  StartLobbyCountdownRequest,
  UpdateLobbyPreferencesRequest,
  UpdateLobbySettingsRequest,
} from '../../common/lobbies/lobby-network'
import { SbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { SbMapId } from '../../common/maps'
import { RaceChar } from '../../common/races'
import { StageReplaySessionSourceResponse } from '../../common/replay-sessions'
import { RolledOutcomeRequest } from '../../common/rolled-outcomes'
import { apiUrl } from '../../common/urls'
import { ThunkAction } from '../dispatch-registry'
import { resolveDesiredRegion } from '../game-server-regions/region-resolution'
import logger from '../logging/logger'
import { abortableThunk, RequestHandlingSpec } from '../network/abortable-thunk'
import { clientId } from '../network/client-id'
import { encodeBodyAsParams, fetchJson } from '../network/fetch'
import siteSocket from '../network/site-socket'
import { ActivateLobby, DeactivateLobby } from './actions'
import { isInLobby } from './lobby-reducer'

const ipcRenderer = new TypedIpcRenderer()

/**
 * Collects the netcode inputs reported alongside a lobby create or join: the occupant's home region,
 * resolved the same way matchmaking does before queueing so their slot homes on a nearby relay at
 * session create, and this session's netcode v2 keypair, generated in the app (only the public half
 * is submitted; the private half stays in the app until the launched game adopts it). Both fall
 * through as absent if nothing's measured / the app can't be reached (e.g. outside Electron) or the
 * lookup fails.
 */
async function resolveNetworkParams(): Promise<LobbyNetworkParams> {
  const [desiredRegion, clientPubkey] = await Promise.all([
    resolveDesiredRegion().catch(() => undefined),
    Promise.resolve(ipcRenderer.invoke('activeGameGenNetcodeV2SessionKeys')).catch(() => undefined),
  ])

  return {
    region: desiredRegion?.region,
    // `rttMs` is nullable on `DesiredRegion` (a manual pick can be unmeasured); the wire format only
    // distinguishes "present" from "absent", so a null rtt is sent as absent. The region itself is
    // still sent: it places the occupant's relay, which needs no rtt.
    rttMs: desiredRegion?.rttMs ?? undefined,
    regionManual: desiredRegion?.manual,
    clientPubkey,
  }
}

export interface CreateLobbyParams {
  name: string
  map: SbMapId
  gameType: GameType
  gameSubType?: number
  useLegacyLimits?: boolean
  starcraftCompatibleReplays?: boolean
  lockedAlliances?: boolean
  allowObservers?: boolean
  visibility?: LobbyVisibility
  /**
   * When set, a client currently in a different lobby is removed from it in the same operation
   * before hosting this one. Without it, being in any gameplay activity fails the create.
   */
  leaveCurrentLobby?: boolean
}

export function createLobby(
  {
    name,
    map,
    gameType,
    gameSubType,
    useLegacyLimits,
    starcraftCompatibleReplays,
    lockedAlliances,
    allowObservers,
    visibility,
    leaveCurrentLobby,
  }: CreateLobbyParams,
  spec: RequestHandlingSpec<CreateLobbyResponse>,
): ThunkAction {
  return abortableThunk(spec, async () => {
    const network = await resolveNetworkParams()

    return await fetchJson<CreateLobbyResponse>(apiUrl`lobbies`, {
      method: 'POST',
      body: encodeBodyAsParams<CreateLobbyRequest>({
        clientId,
        name,
        map,
        gameType,
        gameSubType,
        useLegacyLimits,
        starcraftCompatibleReplays,
        lockedAlliances,
        allowObservers,
        visibility,
        leaveCurrentLobby,
        ...network,
      }),
      signal: spec.signal,
    })
  })
}

/** The replay a replay lobby is created to watch. */
export type LobbyReplayChoice = { kind: 'game'; gameId: string } | { kind: 'local'; path: string }

export type LobbyQueuedSourceChoice =
  | { kind: 'map'; mapId: SbMapId }
  | { kind: 'replay'; hash?: string; choice?: LobbyReplayChoice }

export interface CreateReplayLobbyParams {
  name: string
  replay: LobbyReplayChoice
  visibility?: LobbyVisibility
  /**
   * When set, a client currently in a different lobby is removed from it in the same operation
   * before hosting this one. Without it, being in any gameplay activity fails the create.
   */
  leaveCurrentLobby?: boolean
}

/** Stages a local replay on the server so a replay lobby can be created to watch it. */
async function stageLocalReplay(
  localPath: string,
  signal?: AbortSignal,
): Promise<StageReplaySessionSourceResponse> {
  const data = await ipcRenderer.invoke('fsReadFile', localPath)
  if (!data) {
    throw new Error('Could not read the replay file')
  }
  const formData = new FormData()
  formData.append('replay', new Blob([data], { type: 'application/octet-stream' }), 'replay.rep')

  return await fetchJson<StageReplaySessionSourceResponse>(apiUrl`replay-sessions/sources`, {
    method: 'POST',
    body: formData,
    signal,
  })
}

/** Creates a lobby that watches a replay together, uploading a local replay first. */
export function createReplayLobby(
  { name, replay, visibility, leaveCurrentLobby }: CreateReplayLobbyParams,
  spec: RequestHandlingSpec<CreateLobbyResponse>,
): ThunkAction {
  return abortableThunk(spec, async () => {
    const [network, replayParams] = await Promise.all([
      resolveNetworkParams(),
      replay.kind === 'game'
        ? Promise.resolve({ replayGameId: replay.gameId })
        : stageLocalReplay(replay.path, spec.signal).then(staged => ({
            replayUploadId: staged.sourceId,
          })),
    ])

    return await fetchJson<CreateLobbyResponse>(apiUrl`lobbies`, {
      method: 'POST',
      body: encodeBodyAsParams<CreateLobbyRequest>({
        clientId,
        name,
        visibility,
        leaveCurrentLobby,
        ...replayParams,
        ...network,
      }),
      signal: spec.signal,
    })
  })
}

export interface JoinLobbyParams {
  /**
   * When set, the joiner wants an observer seat specifically: they take an open observer slot or
   * the join fails, rather than being seated as a player or benched.
   */
  asObserver?: boolean
  /**
   * When set, a client currently in a different lobby is removed from it in the same operation
   * before being seated in this one. Without it, being in any gameplay activity fails the join.
   */
  leaveCurrentLobby?: boolean
}

export function joinLobby(
  id: SbLobbyId,
  { asObserver, leaveCurrentLobby }: JoinLobbyParams = {},
  spec: RequestHandlingSpec<void>,
): ThunkAction {
  return abortableThunk(spec, async () => {
    const network = await resolveNetworkParams()

    await fetchJson<void>(apiUrl`lobbies/${id}/join`, {
      method: 'POST',
      body: encodeBodyAsParams<JoinLobbyRequest>({
        clientId,
        asObserver,
        leaveCurrentLobby,
        ...network,
      }),
      signal: spec.signal,
    })
  })
}

/**
 * Sends a request for an operation on the lobby the user is currently in, doing nothing if they
 * aren't in one.
 *
 * The lobby's server-to-client events are what move the view, so a rejected operation simply leaves
 * it as it was. Only the caller knows whether someone is waiting on the outcome, so the rejection
 * is handed back through `spec` rather than being swallowed here.
 */
function currentLobbyRequest(
  spec: RequestHandlingSpec<void>,
  makeRequest: (lobbyId: SbLobbyId) => Promise<void>,
): ThunkAction {
  return abortableThunk(spec, async (_dispatch, getState) => {
    const { lobby } = getState()
    if (!isInLobby(lobby)) {
      return
    }

    await makeRequest(lobby.info.id)
  })
}

/** Sends a request that acts on a single slot of the lobby the user is currently in. */
function currentLobbySlotRequest(
  path: string,
  slotId: string,
  spec: RequestHandlingSpec<void>,
): ThunkAction {
  return currentLobbyRequest(spec, lobbyId =>
    fetchJson<void>(apiUrl`lobbies/${lobbyId}/${path}`, {
      method: 'POST',
      body: encodeBodyAsParams<LobbySlotRequest>({ clientId, slotId }),
      signal: spec.signal,
    }),
  )
}

export function addComputer(slotId: string, spec: RequestHandlingSpec<void>): ThunkAction {
  return currentLobbySlotRequest('add-computer', slotId, spec)
}

export function changeSlot(slotId: string, spec: RequestHandlingSpec<void>): ThunkAction {
  return currentLobbySlotRequest('change-slot', slotId, spec)
}

export function setRace(
  slotId: string,
  race: RaceChar,
  spec: RequestHandlingSpec<void>,
): ThunkAction {
  return currentLobbyRequest(spec, lobbyId =>
    fetchJson<void>(apiUrl`lobbies/${lobbyId}/set-race`, {
      method: 'POST',
      body: encodeBodyAsParams<SetLobbyRaceRequest>({ clientId, slotId, race }),
      signal: spec.signal,
    }),
  )
}

export function openSlot(slotId: string, spec: RequestHandlingSpec<void>): ThunkAction {
  return currentLobbySlotRequest('open-slot', slotId, spec)
}

export function closeSlot(slotId: string, spec: RequestHandlingSpec<void>): ThunkAction {
  return currentLobbySlotRequest('close-slot', slotId, spec)
}

export function kickPlayer(slotId: string, spec: RequestHandlingSpec<void>): ThunkAction {
  return currentLobbySlotRequest('kick-player', slotId, spec)
}

export function banPlayer(slotId: string, spec: RequestHandlingSpec<void>): ThunkAction {
  return currentLobbySlotRequest('ban-player', slotId, spec)
}

export function makeObserver(slotId: string, spec: RequestHandlingSpec<void>): ThunkAction {
  return currentLobbySlotRequest('make-observer', slotId, spec)
}

export function removeObserver(slotId: string, spec: RequestHandlingSpec<void>): ThunkAction {
  return currentLobbySlotRequest('remove-observer', slotId, spec)
}

/** Marks the current user as ready for the lobby's next game, or takes that back. */
export function setReady(isReady: boolean, spec: RequestHandlingSpec<void>): ThunkAction {
  return currentLobbyRequest(spec, lobbyId =>
    fetchJson<void>(apiUrl`lobbies/${lobbyId}/ready`, {
      method: 'POST',
      body: encodeBodyAsParams<SetLobbyReadyRequest>({ clientId, isReady }),
      signal: spec.signal,
    }),
  )
}

/** Exchanges the occupants of the lobby's two player teams. */
export function swapTeams(spec: RequestHandlingSpec<void>): ThunkAction {
  return currentLobbyRequest(spec, lobbyId =>
    fetchJson<void>(apiUrl`lobbies/${lobbyId}/swap-teams`, {
      method: 'POST',
      body: encodeBodyAsParams<LobbyClientRequest>({ clientId }),
      signal: spec.signal,
    }),
  )
}

/** Redistributes the lobby's players randomly among its player slots. */
export function shuffleSlots(spec: RequestHandlingSpec<void>): ThunkAction {
  return currentLobbyRequest(spec, lobbyId =>
    fetchJson<void>(apiUrl`lobbies/${lobbyId}/shuffle`, {
      method: 'POST',
      body: encodeBodyAsParams<LobbyClientRequest>({ clientId }),
      signal: spec.signal,
    }),
  )
}

/**
 * Updates the settings of the lobby the user is currently hosting. `settings` should contain only
 * the fields the caller wants changed (e.g. the diff between a settings form and the lobby's
 * current values) — anything absent is left as-is by the server.
 */
export function updateLobbySettings(
  settings: Partial<Omit<UpdateLobbySettingsRequest, 'clientId'>>,
  spec: RequestHandlingSpec<void>,
  queuedChoices?: ReadonlyArray<LobbyQueuedSourceChoice>,
): ThunkAction {
  return currentLobbyRequest(spec, async lobbyId => {
    let sourceQueue: UpdateLobbySettingsRequest['sourceQueue']
    if (queuedChoices) {
      sourceQueue = []
      for (const entry of queuedChoices) {
        if (entry.kind === 'map') {
          sourceQueue.push({ kind: 'map', mapId: entry.mapId })
        } else if (entry.choice?.kind === 'local') {
          const staged = await stageLocalReplay(entry.choice.path, spec.signal)
          sourceQueue.push({
            kind: 'replay',
            source: { kind: 'upload', sourceId: staged.sourceId },
          })
        } else if (entry.choice?.kind === 'game') {
          sourceQueue.push({ kind: 'replay', source: entry.choice })
        } else if (entry.hash) {
          sourceQueue.push({ kind: 'replay', hash: entry.hash })
        }
      }
    }
    await fetchJson<void>(apiUrl`lobbies/${lobbyId}/settings`, {
      method: 'POST',
      // An empty queue must arrive as an empty array rather than being omitted by form params.
      body: JSON.stringify({ clientId, ...settings, ...(sourceQueue ? { sourceQueue } : {}) }),
      signal: spec.signal,
    })
  })
}

/** Changes the source of the current lobby, staging local replay bytes when needed. */
export function changeLobbySource(
  source: { kind: 'map'; mapId: SbMapId } | LobbyReplayChoice,
  spec: RequestHandlingSpec<void>,
): ThunkAction {
  return abortableThunk(spec, async (_dispatch, getState) => {
    const { lobby } = getState()
    if (!isInLobby(lobby)) return
    let sourceParams: Omit<ChangeLobbySourceRequest, 'clientId'>
    if (source.kind === 'map') {
      sourceParams = { map: source.mapId }
    } else if (source.kind === 'game') {
      sourceParams = { replay: { kind: 'game', gameId: source.gameId } }
    } else {
      sourceParams = {
        replay: {
          kind: 'upload',
          sourceId: (await stageLocalReplay(source.path, spec.signal)).sourceId,
        },
      }
    }
    await fetchJson<void>(apiUrl`lobbies/${lobby.info.id}/source`, {
      method: 'POST',
      body: JSON.stringify({ clientId, ...sourceParams } satisfies ChangeLobbySourceRequest),
      signal: spec.signal,
    })
  })
}

/** Moves the occupant of `fromSlotId` into `toSlotId`, swapping the two occupants if it's taken. */
export function moveSlot(
  fromSlotId: string,
  toSlotId: string,
  spec: RequestHandlingSpec<void>,
): ThunkAction {
  return currentLobbyRequest(spec, lobbyId =>
    fetchJson<void>(apiUrl`lobbies/${lobbyId}/move-slot`, {
      method: 'POST',
      body: encodeBodyAsParams<MoveSlotRequest>({ clientId, fromSlotId, toSlotId }),
      signal: spec.signal,
    }),
  )
}

export function leaveLobby(spec: RequestHandlingSpec<void>): ThunkAction {
  return currentLobbyRequest(spec, lobbyId =>
    fetchJson<void>(apiUrl`lobbies/${lobbyId}/leave`, {
      method: 'POST',
      body: encodeBodyAsParams<LobbyClientRequest>({ clientId }),
      signal: spec.signal,
    }),
  )
}

/**
 * Starts the countdown into the lobby's next game. Without `force`, a lobby whose seated members
 * haven't all marked themselves ready refuses to start.
 */
export function startCountdown(force: boolean, spec: RequestHandlingSpec<void>): ThunkAction {
  return currentLobbyRequest(spec, lobbyId =>
    fetchJson<void>(apiUrl`lobbies/${lobbyId}/start-countdown`, {
      method: 'POST',
      body: encodeBodyAsParams<StartLobbyCountdownRequest>({ clientId, force }),
      signal: spec.signal,
    }),
  )
}

/** Calls off a countdown that's already running. */
export function cancelCountdown(spec: RequestHandlingSpec<void>): ThunkAction {
  return currentLobbyRequest(spec, lobbyId =>
    fetchJson<void>(apiUrl`lobbies/${lobbyId}/cancel-countdown`, {
      method: 'POST',
      body: encodeBodyAsParams<LobbyClientRequest>({ clientId }),
      signal: spec.signal,
    }),
  )
}

export function sendChat(
  text: string,
  spec: RequestHandlingSpec,
  options: { emote?: boolean } = {},
): ThunkAction {
  return abortableThunk(spec, async (_dispatch, getState) => {
    const { lobby } = getState()
    if (!isInLobby(lobby)) {
      return
    }

    await fetchJson<void>(apiUrl`lobbies/${lobby.info.id}/chat`, {
      method: 'POST',
      body: encodeBodyAsParams<SendLobbyChatRequest>({
        clientId,
        text,
        emote: options.emote ? true : undefined,
      }),
      signal: spec.signal,
    })
  })
}

/**
 * Asks the server to settle an outcome (a roll, a coin flip, an 8-ball answer, a unit quote) and
 * announce it.
 */
export function sendOutcome(request: RolledOutcomeRequest, spec: RequestHandlingSpec): ThunkAction {
  return abortableThunk(spec, async (_dispatch, getState) => {
    const { lobby } = getState()
    if (!isInLobby(lobby)) {
      return
    }

    await fetchJson<void>(apiUrl`lobbies/${lobby.info.id}/outcomes`, {
      method: 'POST',
      body: encodeBodyAsParams<SendLobbyOutcomeRequest>({ clientId, ...request }),
      signal: spec.signal,
    })
  })
}

const STATE_CACHE_TIMEOUT = 20 * 1000
export function getLobbyState(lobbyId: SbLobbyId): ThunkAction {
  return (dispatch, getState) => {
    const { lobbyState } = getState()
    const requestTime = window.performance.now()
    if (
      lobbyState.has(lobbyId) &&
      (!lobbyState.get(lobbyId)!.time ||
        requestTime - lobbyState.get(lobbyId)!.time! < STATE_CACHE_TIMEOUT)
    ) {
      return
    }

    dispatch({
      type: '@lobbies/getLobbyStateBegin',
      payload: { lobbyId },
    })
    dispatch({
      type: '@lobbies/getLobbyState',
      payload: fetchJson<GetLobbyStateResponse>(apiUrl`lobbies/${lobbyId}/state`),
      meta: { lobbyId, requestTime },
    })
  }
}

export function getLobbyPreferences(): ThunkAction {
  return dispatch => {
    dispatch({ type: '@lobbies/getPreferencesBegin' })
    dispatch({
      type: '@lobbies/getPreferences',
      payload: fetchJson<LobbyPreferencesResponse>(apiUrl`lobby-preferences`),
    })
  }
}

export function updateLobbyPreferences(
  preferences: ReadonlyDeep<UpdateLobbyPreferencesRequest>,
): ThunkAction {
  return dispatch => {
    dispatch({ type: '@lobbies/updatePreferencesBegin' })
    dispatch({
      type: '@lobbies/updatePreferences',
      payload: fetchJson<LobbyPreferencesResponse>(apiUrl`lobby-preferences`, {
        method: 'post',
        body: JSON.stringify(preferences),
      }),
    })
  }
}

/**
 * Opens a preview of `lobbyId`, which carries its seat-by-seat layout as it changes. A socket holds
 * at most one preview, so this replaces whichever lobby was being previewed before — no separate
 * unsubscribe is needed to move between lobbies.
 */
export function subscribeToLobbyPreview(lobbyId: SbLobbyId): ThunkAction {
  return dispatch => {
    dispatch({ type: '@lobbies/previewSelect', payload: { lobbyId } })

    siteSocket.invoke('/lobbies/preview-subscribe', { lobbyId }).catch(err => {
      // A lobby can close between being picked and this request landing. The list's own delete is
      // what moves the selection off a lobby that's gone, so there's nothing to recover here.
      logger.warning(`Failed to subscribe to lobby preview: ${getErrorStack(err)}`)
    })
  }
}

/** Closes the lobby preview, if one is open. */
export function unsubscribeFromLobbyPreview(): ThunkAction {
  return dispatch => {
    dispatch({ type: '@lobbies/previewSelect', payload: { lobbyId: undefined } })

    siteSocket.invoke('/lobbies/preview-unsubscribe').catch(err => {
      logger.warning(`Failed to unsubscribe from lobby preview: ${getErrorStack(err)}`)
    })
  }
}

export function activateLobby(): ActivateLobby {
  return {
    type: '@lobbies/activate',
  }
}

export function deactivateLobby(): DeactivateLobby {
  return {
    type: '@lobbies/deactivate',
  }
}
