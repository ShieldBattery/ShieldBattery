import { NydusClient } from 'nydus-client'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { getErrorStack } from '../../common/errors'
import { ReplaySessionPlaybackControl } from '../../common/games/game-launch-config'
import { TypedIpcRenderer } from '../../common/ipc'
import {
  ReplaySessionEvent,
  ReplaySessionInvitesEvent,
  ReplaySessionJson,
  SbReplaySessionId,
} from '../../common/replay-sessions'
import { SbUserId } from '../../common/users/sb-user-id'
import { dispatch } from '../dispatch-registry'
import i18n from '../i18n/i18next'
import { jotaiStore } from '../jotai-store'
import logger from '../logging/logger'
import { startReplay } from '../replays/action-creators'
import { externalShowSnackbar } from '../snackbars/snackbar-controller-registry'
import {
  ensureSessionReplayCached,
  leaveReplaySession,
  reportReplaySessionLoaded,
} from './action-creators'
import {
  replaySessionAtom,
  replaySessionChatAtom,
  replaySessionGameAtom,
  replaySessionInvitesAtom,
} from './replay-session-atoms'

/** Sessions whose replay this client has begun launching, so each launches at most once. */
const launchedSessions = new Set<SbReplaySessionId>()

function playbackFor(
  session: ReplaySessionJson,
  selfId: SbUserId | undefined,
): ReplaySessionPlaybackControl {
  return {
    controller: session.hostId === selfId,
    // Until every member has loaded, playback stays held at the start
    paused: session.state !== 'viewing' || session.playback.paused,
  }
}

/**
 * Sends the session's playback state to its game, once the game is ready to take it and only when
 * it changed: the game applies each one it receives, which would override the controller's own
 * use of the replay controls in between.
 */
function sendPlayback(ipcRenderer: TypedIpcRenderer, playback: ReplaySessionPlaybackControl) {
  const game = jotaiStore.get(replaySessionGameAtom)
  if (
    !game?.ready ||
    (game.playback?.controller === playback.controller && game.playback.paused === playback.paused)
  ) {
    return
  }

  jotaiStore.set(replaySessionGameAtom, { ...game, playback })
  ipcRenderer
    .invoke('activeGameSetReplaySessionPlayback', game.gameId, playback)
    ?.catch(swallowNonBuiltins)
}

/** Downloads and verifies the session's replay, then launches it held at its first frame. */
async function launchSessionReplay(session: ReplaySessionJson, selfId: SbUserId | undefined) {
  try {
    const { path, hash } = await ensureSessionReplayCached(session.id)
    if (jotaiStore.get(replaySessionAtom)?.id !== session.id) {
      return
    }

    dispatch(
      startReplay({
        path,
        name: session.source.metadata.mapName,
        session: { ...playbackFor(session, selfId), paused: true },
        onLaunched: gameId => {
          if (jotaiStore.get(replaySessionAtom)?.id === session.id) {
            jotaiStore.set(replaySessionGameAtom, { gameId, hash, ready: false })
          }
        },
      }),
    )
  } catch (err) {
    logger.error(`Error launching replay session replay: ${getErrorStack(err)}`)
    externalShowSnackbar(
      i18n.t(
        'replaySessions.launchFailed',
        "The session's replay couldn't be downloaded, so you left the session.",
      ),
    )
    dispatch(leaveReplaySession(session.id, { onSuccess: () => {}, onError: () => {} }))
  }
}

/** Puts this client's view of its session, and its local game, in step with a new snapshot. */
function applySnapshot(
  ipcRenderer: TypedIpcRenderer,
  session: ReplaySessionJson,
  selfId: SbUserId | undefined,
) {
  const current = jotaiStore.get(replaySessionAtom)
  if (current?.id === session.id && current.revision >= session.revision) {
    return
  }

  if (session.state === 'ended') {
    endSession(ipcRenderer, session.id, current?.state === 'viewing')
    return
  }

  if (current?.id !== session.id) {
    jotaiStore.set(replaySessionChatAtom, [])
  }
  jotaiStore.set(replaySessionAtom, session)

  if (session.state !== 'gathering' && !launchedSessions.has(session.id)) {
    launchedSessions.add(session.id)
    launchSessionReplay(session, selfId).catch(swallowNonBuiltins)
  }
  sendPlayback(ipcRenderer, playbackFor(session, selfId))
}

/**
 * Lets go of a session that is over. A replay that was already playing stays open, with its
 * controls handed back to this viewer; one still loading is quit, since it never started.
 */
function endSession(
  ipcRenderer: TypedIpcRenderer,
  sessionId: SbReplaySessionId,
  wasViewing: boolean,
) {
  if (jotaiStore.get(replaySessionAtom)?.id !== sessionId) {
    return
  }

  const game = jotaiStore.get(replaySessionGameAtom)
  if (game) {
    if (wasViewing) {
      sendPlayback(ipcRenderer, { controller: true, paused: false })
    } else {
      ipcRenderer.invoke('activeGameClearConfig', game.gameId)?.catch(swallowNonBuiltins)
    }
  }

  jotaiStore.set(replaySessionAtom, undefined)
  jotaiStore.set(replaySessionGameAtom, undefined)
  jotaiStore.set(replaySessionChatAtom, [])
}

export default function ({
  siteSocket,
  ipcRenderer,
}: {
  siteSocket: NydusClient
  ipcRenderer: TypedIpcRenderer
}) {
  siteSocket.registerRoute('/replay-sessions/:sessionId', (route, event: ReplaySessionEvent) => {
    if (event.type === 'snapshot') {
      dispatch((_, getState) =>
        applySnapshot(ipcRenderer, event.session, getState().auth.self?.user.id),
      )
    } else if (event.type === 'chat') {
      if (jotaiStore.get(replaySessionAtom)?.id !== route.params.sessionId) {
        return
      }
      dispatch((dispatch, getState) => {
        if (getState().relationships.blocks.has(event.message.from)) {
          return
        }
        dispatch({ type: '@users/loadUsers', payload: event.mentions })
        jotaiStore.set(replaySessionChatAtom, messages => [...messages, event.message])
      })
    } else {
      event satisfies never
    }
  })

  siteSocket.registerRoute(
    '/replay-session-invites/:userId',
    (route, event: ReplaySessionInvitesEvent) => {
      jotaiStore.set(replaySessionInvitesAtom, event.invites)
    },
  )

  ipcRenderer
    .on('activeGameReplaySessionReady', (event, gameId) => {
      const session = jotaiStore.get(replaySessionAtom)
      const game = jotaiStore.get(replaySessionGameAtom)
      if (!session || game?.gameId !== gameId) {
        return
      }
      jotaiStore.set(replaySessionGameAtom, { ...game, ready: true })

      reportReplaySessionLoaded(session.id, game.hash).catch(err => {
        logger.error(`Error reporting replay session load: ${getErrorStack(err)}`)
      })
      dispatch((_, getState) =>
        sendPlayback(ipcRenderer, playbackFor(session, getState().auth.self?.user.id)),
      )
    })
    .on('activeGameStatus', (event, status) => {
      const game = jotaiStore.get(replaySessionGameAtom)
      if (game?.gameId !== status.id) {
        return
      }
      if (status.state === 'finished' || status.state === 'error' || status.state === 'unknown') {
        // Closing the replay is leaving the session: this client can't watch without it
        const session = jotaiStore.get(replaySessionAtom)
        jotaiStore.set(replaySessionGameAtom, undefined)
        if (session) {
          dispatch(leaveReplaySession(session.id, { onSuccess: () => {}, onError: () => {} }))
          jotaiStore.set(replaySessionAtom, undefined)
          jotaiStore.set(replaySessionChatAtom, [])
        }
      }
    })
}
