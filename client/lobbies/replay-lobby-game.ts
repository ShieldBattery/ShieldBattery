import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { getErrorStack } from '../../common/errors'
import { ReplaySessionPlaybackControl } from '../../common/games/game-launch-config'
import { TypedIpcRenderer } from '../../common/ipc'
import {
  LobbyClientRequest,
  ReportLobbyReplayFrameRequest,
  ReportLobbyReplayLoadedRequest,
  ReportLobbyReplaySeekReachedRequest,
  ReportLobbyReplaySeekRequest,
  ReportLobbyReplaySpeedRequest,
  SendLobbyReplayChatRequest,
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
import { jotaiStore } from '../jotai-store'
import logger from '../logging/logger'
import { clientId } from '../network/client-id'
import { encodeBodyAsParams, fetchJson } from '../network/fetch'
import { ensureReplayCached, startReplay } from '../replays/action-creators'
import { externalShowSnackbar } from '../snackbars/snackbar-controller-registry'
import { replayDownloadProgressAtom } from './replay-download-progress'

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
interface CachedLobbyReplay {
  lobbyId: SbLobbyId
  hash: string
  controller: AbortController
  promise: Promise<string>
  failed: boolean
}
let cachedLobbyReplay: CachedLobbyReplay | undefined
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

/** Downloads the selected replay while the lobby gathers, sharing the result with game launch. */
function cacheLobbyReplay(lobbyId: SbLobbyId, hash: string): Promise<string> {
  if (
    cachedLobbyReplay?.lobbyId === lobbyId &&
    cachedLobbyReplay.hash === hash &&
    !cachedLobbyReplay.failed
  ) {
    return cachedLobbyReplay.promise
  }

  cachedLobbyReplay?.controller.abort()
  const controller = new AbortController()
  const entry: CachedLobbyReplay = {
    lobbyId,
    hash,
    controller,
    failed: false,
    promise: Promise.resolve(''),
  }
  cachedLobbyReplay = entry
  jotaiStore.set(replayDownloadProgressAtom, {
    lobbyId,
    hash,
    state: 'downloading',
    loadedBytes: 0,
    totalBytes: 0,
  })
  entry.promise = fetchJson<GetReplaySessionSourceResponse>(
    apiUrl`lobbies/${lobbyId}/replay-source` + `?${new URLSearchParams({ clientId })}`,
    { signal: controller.signal },
  )
    .then(async source => {
      if (source.hash !== hash) {
        throw new Error('Lobby replay changed during download')
      }
      const path = await ensureReplayCached(
        { id: hash, url: source.url, hash },
        controller.signal,
        {
          totalBytes: source.size,
          onProgress: (loadedBytes, totalBytes) => {
            if (cachedLobbyReplay === entry) {
              jotaiStore.set(replayDownloadProgressAtom, {
                lobbyId,
                hash,
                state: 'downloading',
                loadedBytes,
                totalBytes,
              })
            }
          },
        },
      )
      if (!path) {
        throw new Error('Could not cache the replay')
      }
      if (cachedLobbyReplay === entry) {
        jotaiStore.set(replayDownloadProgressAtom, {
          lobbyId,
          hash,
          state: 'ready',
          loadedBytes: source.size,
          totalBytes: source.size,
        })
      }
      return path
    })
    .catch(err => {
      entry.failed = true
      if (cachedLobbyReplay === entry && !controller.signal.aborted) {
        jotaiStore.set(replayDownloadProgressAtom, {
          lobbyId,
          hash,
          state: 'error',
          loadedBytes: 0,
          totalBytes: 0,
        })
      }
      throw err
    })
  return entry.promise
}

/** Starts caching a replay as soon as it is selected or this client joins its lobby. */
export function preloadLobbyReplay(lobbyId: SbLobbyId, hash: string) {
  if (!IS_ELECTRON) return
  cacheLobbyReplay(lobbyId, hash).catch(err => {
    if (!(err instanceof DOMException && err.name === 'AbortError')) {
      logger.error(`Error caching replay for lobby ${lobbyId}: ${getErrorStack(err)}`)
    }
  })
}

export function clearLobbyReplayCache(lobbyId: SbLobbyId) {
  if (cachedLobbyReplay?.lobbyId !== lobbyId) return
  cachedLobbyReplay.controller.abort()
  cachedLobbyReplay = undefined
  jotaiStore.set(replayDownloadProgressAtom, undefined)
}

/**
 * Waits for the selected replay's cache entry, then launches it held at its start. The server starts
 * playback for everyone once every viewer reports it loaded.
 */
export function loadLobbyReplay(lobbyId: SbLobbyId, mapName: string): ThunkAction {
  return (dispatch, getState) => {
    const isHost = selfIsHost(getState)
    const hash = getState().lobby.info.replay?.hash
    if (!hash) return
    const generation = ++loadGeneration
    pendingLobbyId = lobbyId
    cacheLobbyReplay(lobbyId, hash)
      .then(path => {
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

/** Restores both playback fields together when a lobby socket reconnects during a seek. */
export function restoreLobbyReplayPlayback(
  lobbyId: SbLobbyId,
  speed: ReplaySessionSpeed | undefined,
  seek: ReplaySessionSeek | undefined,
): ThunkAction {
  return (dispatch, getState) => {
    if (current?.lobbyId === lobbyId) {
      current.speed = speed ?? current.speed
      current.seek = seek
      sendPlayback(selfIsHost(getState))
    }
  }
}

/** Shows replay chat in the native game log while this client is watching. */
export function showLobbyReplayChat(
  lobbyId: SbLobbyId,
  from: string,
  text: string,
  isSelf: boolean,
) {
  if (current?.lobbyId === lobbyId && current.gameId && current.started) {
    ipcRenderer
      .invoke('activeGameShowReplaySessionChat', current.gameId, from, text, isSelf)
      ?.catch(swallowNonBuiltins)
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
  clearLobbyReplayCache(lobbyId)
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
    .on('activeGameReplaySessionFrame', (event, gameId, frame) => {
      if (current?.gameId !== gameId || !current.started || current.seek) {
        return
      }
      const body = encodeBodyAsParams<ReportLobbyReplayFrameRequest>({ clientId, frame })
      fetchJson<void>(apiUrl`lobbies/${current.lobbyId}/replay-frame`, {
        method: 'POST',
        body,
      }).catch(err => {
        logger.error(`Error reporting replay frame: ${getErrorStack(err)}`)
      })
    })
    .on('activeGameReplaySessionChat', (event, gameId, text) => {
      if (current?.gameId !== gameId || !current.started) {
        return
      }
      const body = encodeBodyAsParams<SendLobbyReplayChatRequest>({ clientId, text })
      fetchJson<void>(apiUrl`lobbies/${current.lobbyId}/replay-chat`, {
        method: 'POST',
        body,
      }).catch(err => {
        logger.error(`Error sending replay chat: ${getErrorStack(err)}`)
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
