import { NydusClient, RouteInfo } from 'nydus-client'
import { assertUnreachable } from '../../common/assert-unreachable'
import { GameSubscriptionEvent } from '../../common/games/games'
import { TypedIpcRenderer } from '../../common/ipc'
import { apiUrl } from '../../common/urls'
import { dispatch } from '../dispatch-registry'
import logger from '../logging/logger'
import { fetchJson } from '../network/fetch'

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
      // TODO(#542): Retry submission of these results more times/for longer to try and ensure
      // complete resutls on the server
      logger.verbose('Game failed to send result, retrying once from the app')
      fetchJson<void>(apiUrl`games/${gameId}/results`, {
        method: 'POST',
        body: JSON.stringify(requestBody),
      })
        .then(() => {
          logger.verbose('Game result submitted successfully')
        })
        .catch(err => {
          logger.error(`Game result submission failed: ${(err as any)?.stack ?? err}`)
        })
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
