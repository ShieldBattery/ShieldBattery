import { NydusClient } from 'nydus-client'
import { LobbyPreviewJson, LobbySummaryJson } from '../../common/lobbies/lobby-network'
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

  // Registered ahead of the per-lobby channels (`/lobbies/:lobbyId/:userId` and friends, mounted by
  // the Electron-only handlers) so this more specific pattern gets first claim on the path.
  siteSocket.registerRoute('/lobbies/:lobbyId/preview', (route, event) => {
    const { payload } = event
    dispatch({
      type: '@lobbies/previewUpdate',
      payload: payload as LobbyPreviewJson,
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
