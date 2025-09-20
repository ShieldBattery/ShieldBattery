import { NydusClient, RouteInfo } from 'nydus-client'
import { assertUnreachable } from '../../common/assert-unreachable'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { getErrorStack } from '../../common/errors'
import { GameSubscriptionEvent } from '../../common/games/games'
import { GameResultErrorCode } from '../../common/games/results'
import { TypedIpcRenderer } from '../../common/ipc'
import { apiUrl } from '../../common/urls'
import { dispatch } from '../dispatch-registry'
import logger from '../logging/logger'
import { fetchJson } from '../network/fetch'
import { isFetchError } from '../network/fetch-errors'

export default function ({
  ipcRenderer,
  siteSocket,
}: {
  ipcRenderer: TypedIpcRenderer
  siteSocket: NydusClient
}) {
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
    .on('activeGameResendResults', (_, gameId, requestBody) => {
      const ATTEMPTS = 20
      const DELAY_MILLIS = 30 * 1000 // 30 seconds

      logger.verbose('Game failed to send result, retrying from the app')
      Promise.resolve()
        .then(async () => {
          for (let i = 0; i < ATTEMPTS; i++) {
            try {
              await fetchJson<void>(apiUrl`games/${gameId}/results2`, {
                method: 'POST',
                body: JSON.stringify(requestBody),
                signal: AbortSignal.timeout(5000),
              })
              logger.verbose('Game result resent successfully')
              return
            } catch (err) {
              if (isFetchError(err)) {
                if (err.code === GameResultErrorCode.AlreadyReported) {
                  logger.verbose(`Game result already reported, not retrying further`)
                  return
                } else if (err.code === GameResultErrorCode.NotFound) {
                  logger.warning(`Game result resend failed, game not found!`)
                  return
                }
              }

              logger.error(
                `Game result resend ${i + 1} / ${ATTEMPTS} failed: ${getErrorStack(err)}`,
              )
            }

            await new Promise(resolve => setTimeout(resolve, DELAY_MILLIS))
          }
        })
        .catch(swallowNonBuiltins)
    })
    .on('activeGameResendReplay', (_, request) => {
      const ATTEMPTS = 10
      const DELAY_MILLIS = 30 * 1000 // 30 seconds

      logger.verbose('Game failed to upload replay, retrying from the app')
      Promise.resolve()
        .then(async () => {
          for (let i = 0; i < ATTEMPTS; i++) {
            try {
              const file = await ipcRenderer.invoke('fsReadFile', request.replayPath)
              if (!file) {
                logger.verbose(`Replay file ${request.replayPath} doesn't exist, skipping`)
                return
              }

              const formData = new FormData()
              formData.append('userId', String(request.userId))
              formData.append('resultCode', request.resultCode)
              formData.append('replay', new Blob([file]))

              await fetchJson<void>(apiUrl`games/${request.gameId}/replay`, {
                method: 'POST',
                body: formData,
              })
              logger.verbose('Replay uploaded successfully')

              // Clean up the temporary replay file
              ipcRenderer.invoke('fsUnlink', request.replayPath)?.catch(err => {
                logger.warning(`Failed to delete temporary replay file: ${getErrorStack(err)}`)
              })
              return
            } catch (err) {
              logger.error(`Replay upload ${i + 1} / ${ATTEMPTS} failed: ${getErrorStack(err)}`)
            }

            await new Promise(resolve => setTimeout(resolve, DELAY_MILLIS))
          }

          logger.error(
            `Failed to upload replay after ${ATTEMPTS} attempts, leaving file for debugging`,
          )
        })
        .catch(swallowNonBuiltins)
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
