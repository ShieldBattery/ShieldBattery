import { NydusClient } from 'nydus-client'
import { LobbySummaryJson } from '../../common/lobbies/lobby-network'
import { dispatch } from '../dispatch-registry'

export default function registerModule({ siteSocket }: { siteSocket: NydusClient }) {
  siteSocket.registerRoute('/lobbies', (route, event) => {
    const { action, payload } = event
    dispatch({
      type: '@lobbies/listUpdate',
      payload: {
        message: action,
        data: payload as LobbySummaryJson,
      },
    })
  })

  siteSocket.registerRoute('/lobbiesCount', (route, event) => {
    const { count } = event
    dispatch({
      type: '@lobbies/countUpdate',
      payload: {
        count,
      },
    })
  })
}
