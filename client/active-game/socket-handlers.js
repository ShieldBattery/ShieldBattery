import activeGameManager from './active-game-manager-instance'
import fetch from '../network/fetch'
import { dispatch } from '../dispatch-registry'

import { ACTIVE_GAME_STATUS } from '../actions'

export default function () {
  if (!activeGameManager) {
    return
  }

  activeGameManager.on('gameStatus', status => {
    dispatch({
      type: ACTIVE_GAME_STATUS,
      payload: status,
    })

    if (status.state === 'playing') {
      fetch('/api/1/games/' + encodeURIComponent(status.id), { method: 'put' })
    } else if (status.state === 'error') {
      fetch('/api/1/games/' + encodeURIComponent(status.id), { method: 'delete' })
    }
  })
}
