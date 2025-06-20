import { NydusClient } from 'nydus-client'
import { LobbySummaryJson } from '../../common/lobbies/lobby-network'
import { LOBBIES_COUNT_UPDATE, LOBBIES_LIST_UPDATE } from '../actions'
import { dispatch } from '../dispatch-registry'

export default function registerModule({ siteSocket }: { siteSocket: NydusClient }) {
  siteSocket.registerRoute('/lobbies', (route, event) => {
    const { action, payload } = event
    dispatch({
      type: LOBBIES_LIST_UPDATE,
      payload: {
        message: action,
        data: payload as LobbySummaryJson,
      },
    } as any)
  })

  siteSocket.registerRoute('/lobbiesCount', (route, event) => {
    const { count } = event
    dispatch({
      type: LOBBIES_COUNT_UPDATE,
      payload: {
        count,
      },
    } as any)
  })
}
