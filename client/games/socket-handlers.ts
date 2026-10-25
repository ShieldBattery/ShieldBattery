import { NydusClient, RouteInfo } from 'nydus-client'
import { assertUnreachable } from '../../common/assert-unreachable'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { getErrorStack } from '../../common/errors'
import { CommendEvent } from '../../common/games/commends'
import { GameSubscriptionEvent } from '../../common/games/games'
import { GameResultErrorCode } from '../../common/games/results'
import { TypedIpcRenderer } from '../../common/ipc'
import { CommendReceivedNotification, NotificationType } from '../../common/notifications'
import { apiUrl } from '../../common/urls'
import { sendReplayDiagnosticReport } from '../bugs/action-creators'
import { dispatch } from '../dispatch-registry'
import logger from '../logging/logger'
import { fetchJson } from '../network/fetch'
import { isFetchError } from '../network/fetch-errors'
import { addLocalNotification } from '../notifications/action-creators'

export default function ({
  ipcRenderer,
  siteSocket,
}: {
  ipcRenderer: TypedIpcRenderer
  siteSocket: NydusClient
}) {
  function deleteTempReplay(replayPath: string) {
    ipcRenderer.invoke('fsUnlink', replayPath)?.catch(err => {
      logger.warning(`Failed to delete temporary replay file: ${getErrorStack(err)}`)
    })
  }

  function sendReplayDiagnostics(gameId: string, replayPath: string, code: string) {
    logger.warning(`Sending a diagnostic report for the rejected replay of game ${gameId}`)
    sendReplayDiagnosticReport(gameId, replayPath, code)
      .then(() => deleteTempReplay(replayPath))
      .catch(err => {
        logger.error(`Failed to send replay diagnostic report: ${getErrorStack(err)}`)
      })
  }

  ipcRenderer
    .on('activeGameResult', (event, { gameId, result, time }) => {
      dispatch({
        type: '@games/deliverLocalResults',
        payload: {
          gameId,
          result,
          time,
        },
      })
    })
    .on('activeGameResendReplay', (_, request) => {
      const ATTEMPTS = 10
      const DELAY_MILLIS = 30 * 1000 // 30 seconds

      logger.verbose('Game failed to upload replay, retrying from the app')
      Promise.resolve()
        .then(async () => {
          // Read the replay once and reuse it across retries, rather than re-reading it over IPC
          // (a whole-file copy across the process boundary) on every attempt.
          const file = await ipcRenderer.invoke('fsReadFile', request.replayPath)
          if (!file) {
            logger.verbose(`Replay file ${request.replayPath} doesn't exist, skipping`)
            return
          }

          for (let i = 0; i < ATTEMPTS; i++) {
            try {
              const formData = new FormData()
              formData.append('userId', String(request.userId))
              formData.append('resultCode', request.resultCode)
              formData.append('replay', new Blob([file]))

              await fetchJson<void>(apiUrl`games/${request.gameId}/replay`, {
                method: 'POST',
                body: formData,
                signal: AbortSignal.timeout(90_000),
              })
              logger.verbose('Replay uploaded successfully')

              deleteTempReplay(request.replayPath)
              return
            } catch (err) {
              logger.error(`Replay upload ${i + 1} / ${ATTEMPTS} failed: ${getErrorStack(err)}`)
              // The server judged the file itself, so another attempt can't change the answer.
              if (
                isFetchError(err) &&
                (err.code === GameResultErrorCode.ReplayRejected ||
                  err.code === GameResultErrorCode.ReplaySeedMissing)
              ) {
                sendReplayDiagnostics(request.gameId, request.replayPath, err.code)
                return
              }
            }

            await new Promise(resolve => setTimeout(resolve, DELAY_MILLIS))
          }

          logger.error(
            `Failed to upload replay after ${ATTEMPTS} attempts, leaving file for debugging`,
          )
        })
        .catch(swallowNonBuiltins)
    })
    .on('activeGameReplayDiagnosticsRequested', (_, { gameId, replayPath, code }) => {
      sendReplayDiagnostics(gameId, replayPath, code)
    })

  siteSocket.registerRoute('/commends/:userId', (_route: RouteInfo, event: CommendEvent) => {
    if (event.type === 'commendReceived') {
      // A local notification: shown and listed like any other, but never stored on the server.
      // One commend per commender per game makes this id unique, so a repeated event replaces its
      // entry instead of adding a second one.
      dispatch(
        addLocalNotification<CommendReceivedNotification>({
          id: `commend:${event.gameId}:${event.commenderId}`,
          type: NotificationType.CommendReceived,
          commenderId: event.commenderId,
          gameId: event.gameId,
        }),
      )
    } else {
      assertUnreachable(event.type)
    }
  })

  siteSocket.registerRoute('/games/:gameId', (route: RouteInfo, event: GameSubscriptionEvent) => {
    if (event.type === 'update') {
      dispatch({
        type: '@games/gameUpdate',
        payload: event,
      })
    } else {
      assertUnreachable(event.type)
    }
  })
}
