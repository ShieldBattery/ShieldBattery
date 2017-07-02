import activeGameManager from './active-game-manager-instance'
import { dispatch } from '../dispatch-registry'

import { ACTIVE_GAME_STATUS } from '../actions'

export default function({ siteSocket }) {
  if (!activeGameManager) {
    return
  }

  activeGameManager.on('gameStatus', status => {
    dispatch({
      type: ACTIVE_GAME_STATUS,
      payload: status,
    })

    // TODO(tec27): Only invoke the lobby API for lobby loads, need to split this out for e.g.
    // replays and AMM and such.
    if (status.state === 'playing') {
      siteSocket.invoke('/lobbies/gameLoaded')
    } else if (status.state === 'error') {
      siteSocket.invoke('/lobbies/loadFailed')
    }
  })
}
