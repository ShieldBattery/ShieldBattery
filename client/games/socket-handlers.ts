import { NydusClient, RouteInfo } from 'nydus-client'
import { assertUnreachable } from '../../common/assert-unreachable'
import { GameSubscriptionEvent } from '../../common/games/games'
import { TypedIpcRenderer } from '../../common/ipc'
import { dispatch } from '../dispatch-registry'

export default function ({
  ipcRenderer,
  siteSocket,
}: {
  ipcRenderer: TypedIpcRenderer
  siteSocket: NydusClient
}) {
  ipcRenderer.on('activeGameResult', (event, { gameId, result, time }) => {
    dispatch({
      type: '@games/deliverLocalResults',
      payload: {
        gameId,
        result,
        time,
      },
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
