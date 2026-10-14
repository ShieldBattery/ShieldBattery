import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { getErrorStack } from '../../common/errors'
import { ReplaySessionPlaybackControl } from '../../common/games/game-launch-config'
import { TypedIpcRenderer } from '../../common/ipc'
import {
  LobbyClientRequest,
  ReportLobbyReplayLoadedRequest,
  ReportLobbyReplaySeekReachedRequest,
  ReportLobbyReplaySeekRequest,
  ReportLobbyReplaySpeedRequest,
} from '../../common/lobbies/lobby-network'
import { SbLobbyId } from '../../common/lobbies/sb-lobby-id'
import {
  GetReplaySessionSourceResponse,
  ReplaySessionSeek,
  ReplaySessionSpeed,
} from '../../common/replay-sessions'
import { apiUrl } from '../../common/urls'
import { ThunkAction } from '../dispatch-registry'
import i18n from '../i18n/i18next'
import logger from '../logging/logger'
import { clientId } from '../network/client-id'
import { encodeBodyAsParams, fetchJson } from '../network/fetch'
import { ensureReplayCached, startReplay } from '../replays/action-creators'
import { externalShowSnackbar } from '../snackbars/snackbar-controller-registry'

const ipcRenderer = new TypedIpcRenderer()

/** The local game playing a replay lobby's replay. */
interface ReplayLobbyGame {
  lobbyId: SbLobbyId
  /** Set once the app has accepted the game's configuration. */
  gameId?: string
  /** The hash the replay's bytes were verified against. */
  hash: string
  /** Whether the game has loaded the replay and is holding it at the start. */
  ready: boolean
  /** Whether the lobby's run has started, letting playback go. */
  started: boolean
  speed: ReplaySessionSpeed
  seek?: ReplaySessionSeek
  /** The playback state last sent to the game, so it is only sent again when it changes. */
  playback?: ReplaySessionPlaybackControl
}

let current: ReplayLobbyGame | undefined
let pendingLobbyId: SbLobbyId | undefined
let loadGeneration = 0
const initialSpeed: ReplaySessionSpeed = { paused: false, speed: 6, multiplier: 1 }

function postLobbyReplayAction(
  lobbyId: SbLobbyId,
  action: 'replay-loaded' | 'replay-load-failed' | 'replay-ended',
  hash?: string,
) {
  const body =
    action === 'replay-loaded'
      ? encodeBodyAsParams<ReportLobbyReplayLoadedRequest>({ clientId, hash: hash! })
      : encodeBodyAsParams<LobbyClientRequest>({ clientId })
  fetchJson<void>(apiUrl`lobbies/${lobbyId}/${action}`, { method: 'POST', body }).catch(err => {
    logger.error(`Error reporting ${action} for lobby ${lobbyId}: ${getErrorStack(err)}`)
  })
}

/**
 * Sends the lobby's playback state to its game once the game is ready to take it, and only when
 * it changed: the game applies each one it receives, which would override the controller's own use
 * of the replay controls in between.
 */
function sendPlayback(isHost: boolean) {
  if (!current?.gameId || !current.ready) {
    return
  }
  const playback: ReplaySessionPlaybackControl = {
    controller: isHost,
    paused: !current.started || current.speed.paused,
    speed: current.speed.speed,
    multiplier: current.speed.multiplier,
    seek: current.seek,
  }
  if (
    current.playback?.controller === playback.controller &&
    current.playback.paused === playback.paused &&
    current.playback.speed === playback.speed &&
    current.playback.multiplier === playback.multiplier &&
    current.playback.seek?.epoch === playback.seek?.epoch &&
    current.playback.seek?.frame === playback.seek?.frame
  ) {
    return
  }

  current.playback = playback
  ipcRenderer
    .invoke('activeGameSetReplaySessionPlayback', current.gameId, playback)
    ?.catch(swallowNonBuiltins)
}

function selfIsHost(getState: Parameters<ThunkAction>[1]): boolean {
  const { auth, lobby } = getState()
  return auth.self !== undefined && lobby.info.host.userId === auth.self.user.id
}

function failLoad(lobbyId: SbLobbyId) {
  if (current?.lobbyId === lobbyId) {
    current = undefined
  }
  externalShowSnackbar(
    i18n.t('lobbies.replayLobby.loadFailed', "The lobby's replay couldn't be loaded."),
  )
  postLobbyReplayAction(lobbyId, 'replay-load-failed')
}

/**
 * Downloads a replay lobby's replay, checks it against the lobby's hash, and launches it held at
 * its start. The server starts playback for everyone once every viewer reports it loaded.
 */
export function loadLobbyReplay(lobbyId: SbLobbyId, mapName: string): ThunkAction {
  return (dispatch, getState) => {
    const isHost = selfIsHost(getState)
    const generation = ++loadGeneration
    pendingLobbyId = lobbyId
    fetchJson<GetReplaySessionSourceResponse>(
      apiUrl`lobbies/${lobbyId}/replay-source` + `?${new URLSearchParams({ clientId })}`,
    )
      .then(async source => {
        // The cache only keeps a replay whose bytes hash to what the server says the lobby plays,
        // so the hash also serves as the cache entry's id: a lobby replay's identity is its content.
        const path = await ensureReplayCached({
          id: source.hash,
          url: source.url,
          hash: source.hash,
        })
        if (!path) {
          throw new Error('Could not cache the replay')
        }
        return { path, hash: source.hash }
      })
      .then(({ path, hash }) => {
        if (generation !== loadGeneration || pendingLobbyId !== lobbyId) {
          return
        }
        pendingLobbyId = undefined
        current = { lobbyId, hash, ready: false, started: false, speed: initialSpeed }
        dispatch(
          startReplay({
            path,
            name: mapName,
            session: { controller: isHost, paused: true },
            onLaunched: gameId => {
              if (generation === loadGeneration && current?.lobbyId === lobbyId) {
                current.gameId = gameId
              } else {
                ipcRenderer.invoke('activeGameClearConfig', gameId)?.catch(swallowNonBuiltins)
              }
            },
            onLaunchFailed: () => {
              if (generation === loadGeneration) {
                failLoad(lobbyId)
              }
            },
          }),
        )
      })
      .catch(err => {
        if (generation !== loadGeneration) {
          return
        }
        logger.error(`Error loading the replay for lobby ${lobbyId}: ${getErrorStack(err)}`)
        pendingLobbyId = undefined
        failLoad(lobbyId)
      })
  }
}

/** Lets a replay lobby's replay play, now that everyone watching has loaded it. */
export function startLobbyReplay(lobbyId: SbLobbyId): ThunkAction {
  return (dispatch, getState) => {
    if (current?.lobbyId !== lobbyId) {
      return
    }
    current.started = true
    sendPlayback(selfIsHost(getState))
  }
}

/** Hands control of playback to whoever hosts the replay lobby now. */
export function updateLobbyReplayController(lobbyId: SbLobbyId): ThunkAction {
  return (dispatch, getState) => {
    if (current?.lobbyId === lobbyId) {
      sendPlayback(selfIsHost(getState))
    }
  }
}

/** Applies the room host's timeline state to this viewer's game. */
export function applyLobbyReplaySpeed(lobbyId: SbLobbyId, speed: ReplaySessionSpeed): ThunkAction {
  return (dispatch, getState) => {
    if (current?.lobbyId === lobbyId) {
      current.speed = speed
      sendPlayback(selfIsHost(getState))
    }
  }
}

/** Applies a coordinated timeline move to this viewer's game. */
export function applyLobbyReplaySeek(lobbyId: SbLobbyId, seek?: ReplaySessionSeek): ThunkAction {
  return (dispatch, getState) => {
    if (current?.lobbyId === lobbyId) {
      current.seek = seek
      sendPlayback(selfIsHost(getState))
    }
  }
}

/** Quits a replay lobby's replay that never got to play, since its load was called off. */
export function cancelLobbyReplay(lobbyId: SbLobbyId) {
  if (current?.lobbyId !== lobbyId && pendingLobbyId !== lobbyId) {
    return
  }
  loadGeneration += 1
  pendingLobbyId = undefined
  if (current?.lobbyId === lobbyId) {
    if (current.gameId && !current.started) {
      ipcRenderer.invoke('activeGameClearConfig', current.gameId)?.catch(swallowNonBuiltins)
    }
    current = undefined
  }
}

/**
 * Lets go of a replay lobby's replay when this client leaves the lobby. A replay that is playing
 * stays open with its controls handed back to this viewer; one still loading is quit.
 */
export function releaseLobbyReplay(lobbyId: SbLobbyId) {
  if (current?.lobbyId !== lobbyId && pendingLobbyId !== lobbyId) {
    return
  }
  if (current?.lobbyId === lobbyId && current.started) {
    current.seek = undefined
    sendPlayback(true)
    current = undefined
  } else {
    cancelLobbyReplay(lobbyId)
  }
}

/** Registers the app events that drive a replay lobby's local game. */
export function registerReplayLobbyGameEvents(dispatchThunk: (thunk: ThunkAction) => void) {
  ipcRenderer
    .on('activeGameReplaySessionReady', (event, gameId) => {
      if (current?.gameId !== gameId) {
        return
      }
      current.ready = true
      postLobbyReplayAction(current.lobbyId, 'replay-loaded', current.hash)
      dispatchThunk((dispatch, getState) => sendPlayback(selfIsHost(getState)))
    })
    .on('activeGameReplaySessionSpeed', (event, gameId, speed) => {
      if (current?.gameId !== gameId || !current.started) {
        return
      }
      const body = encodeBodyAsParams<ReportLobbyReplaySpeedRequest>({ clientId, ...speed })
      fetchJson<void>(apiUrl`lobbies/${current.lobbyId}/replay-speed`, {
        method: 'POST',
        body,
      }).catch(err => {
        logger.error(`Error reporting replay speed: ${getErrorStack(err)}`)
      })
    })
    .on('activeGameReplaySessionSeek', (event, gameId, frame) => {
      if (current?.gameId !== gameId || !current.started) {
        return
      }
      const body = encodeBodyAsParams<ReportLobbyReplaySeekRequest>({ clientId, frame })
      fetchJson<void>(apiUrl`lobbies/${current.lobbyId}/replay-seek`, {
        method: 'POST',
        body,
      }).catch(err => {
        logger.error(`Error requesting replay seek: ${getErrorStack(err)}`)
      })
    })
    .on('activeGameReplaySessionSeekReached', (event, gameId, seek) => {
      if (
        current?.gameId !== gameId ||
        current.seek?.epoch !== seek.epoch ||
        current.seek.frame !== seek.frame
      ) {
        return
      }
      const body = encodeBodyAsParams<ReportLobbyReplaySeekReachedRequest>({ clientId, ...seek })
      fetchJson<void>(apiUrl`lobbies/${current.lobbyId}/replay-seek-reached`, {
        method: 'POST',
        body,
      }).catch(err => {
        logger.error(`Error reporting replay seek: ${getErrorStack(err)}`)
      })
    })
    .on('activeGameStatus', (event, status) => {
      if (!current || current.gameId !== status.id) {
        return
      }
      if (status.state === 'finished' || status.state === 'error' || status.state === 'unknown') {
        const { lobbyId, started } = current
        current = undefined
        postLobbyReplayAction(lobbyId, started ? 'replay-ended' : 'replay-load-failed')
      }
    })
}
