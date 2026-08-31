import { ReadonlyDeep } from 'type-fest'
import { getErrorStack } from '../../common/errors'
import { GameType } from '../../common/games/game-type'
import { TypedIpcRenderer } from '../../common/ipc'
import { LobbyVisibility } from '../../common/lobbies'
import {
  CreateLobbyRequest,
  CreateLobbyResponse,
  GetLobbyStateResponse,
  JoinLobbyRequest,
  LobbyClientRequest,
  LobbyNetworkParams,
  LobbyPreferencesResponse,
  LobbySlotRequest,
  SendLobbyChatRequest,
  SetLobbyRaceRequest,
  UpdateLobbyPreferencesRequest,
} from '../../common/lobbies/lobby-network'
import { SbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { SbMapId } from '../../common/maps'
import { RaceChar } from '../../common/races'
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
        allowObservers,
        visibility,
        leaveCurrentLobby,
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
 * Nothing consumes the outcome: the lobby's server-to-client events are what move the view, so a
 * failed operation simply leaves it as it was, and the failure is logged rather than surfaced.
 */
function currentLobbyRequest(
  description: string,
  makeRequest: (lobbyId: SbLobbyId) => Promise<void>,
): ThunkAction {
  return (_dispatch, getState) => {
    const { lobby } = getState()
    if (!isInLobby(lobby)) {
      return
    }

    makeRequest(lobby.info.id).catch(err => {
      logger.error(`Error while ${description}: ${getErrorStack(err)}`)
    })
  }
}

/** Sends a request that acts on a single slot of the lobby the user is currently in. */
function currentLobbySlotRequest(description: string, path: string, slotId: string): ThunkAction {
  return currentLobbyRequest(description, lobbyId =>
    fetchJson<void>(apiUrl`lobbies/${lobbyId}/${path}`, {
      method: 'POST',
      body: encodeBodyAsParams<LobbySlotRequest>({ clientId, slotId }),
    }),
  )
}

export function addComputer(slotId: string): ThunkAction {
  return currentLobbySlotRequest('adding a computer', 'add-computer', slotId)
}

export function changeSlot(slotId: string): ThunkAction {
  return currentLobbySlotRequest('changing slots', 'change-slot', slotId)
}

export function setRace(slotId: string, race: RaceChar): ThunkAction {
  return currentLobbyRequest('setting a race', lobbyId =>
    fetchJson<void>(apiUrl`lobbies/${lobbyId}/set-race`, {
      method: 'POST',
      body: encodeBodyAsParams<SetLobbyRaceRequest>({ clientId, slotId, race }),
    }),
  )
}

export function openSlot(slotId: string): ThunkAction {
  return currentLobbySlotRequest('opening a slot', 'open-slot', slotId)
}

export function closeSlot(slotId: string): ThunkAction {
  return currentLobbySlotRequest('closing a slot', 'close-slot', slotId)
}

export function kickPlayer(slotId: string): ThunkAction {
  return currentLobbySlotRequest('kicking a player', 'kick-player', slotId)
}

export function banPlayer(slotId: string): ThunkAction {
  return currentLobbySlotRequest('banning a player', 'ban-player', slotId)
}

export function makeObserver(slotId: string): ThunkAction {
  return currentLobbySlotRequest('making a player an observer', 'make-observer', slotId)
}

export function removeObserver(slotId: string): ThunkAction {
  return currentLobbySlotRequest('removing an observer', 'remove-observer', slotId)
}

export function leaveLobby(): ThunkAction {
  return currentLobbyRequest('leaving a lobby', lobbyId =>
    fetchJson<void>(apiUrl`lobbies/${lobbyId}/leave`, {
      method: 'POST',
      body: encodeBodyAsParams<LobbyClientRequest>({ clientId }),
    }),
  )
}

export function startCountdown(): ThunkAction {
  return currentLobbyRequest('starting a lobby countdown', lobbyId =>
    fetchJson<void>(apiUrl`lobbies/${lobbyId}/start-countdown`, {
      method: 'POST',
      body: encodeBodyAsParams<LobbyClientRequest>({ clientId }),
    }),
  )
}

export function sendChat(text: string): ThunkAction {
  return currentLobbyRequest('sending a lobby chat message', lobbyId =>
    fetchJson<void>(apiUrl`lobbies/${lobbyId}/chat`, {
      method: 'POST',
      body: encodeBodyAsParams<SendLobbyChatRequest>({ clientId, text }),
    }),
  )
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
