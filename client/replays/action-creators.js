import { routerActions } from 'react-router-redux'
import { List } from 'immutable'
import cuid from 'cuid'
import readFolder from './get-files'
import activeGameManager from '../active-game/active-game-manager-instance'
import { Slot } from '../lobbies/lobby-reducer'
import {
  REPLAYS_CHANGE_PATH,
  REPLAYS_GET_BEGIN,
  REPLAYS_GET,
  REPLAYS_START_REPLAY,
} from '../actions'

export function getFiles(browseId, path) {
  return dispatch => {
    dispatch({
      type: REPLAYS_GET_BEGIN,
      payload: {
        browseId,
        path,
      },
    })

    dispatch({
      type: REPLAYS_GET,
      payload: readFolder(path),
      meta: {
        browseId,
        path,
      },
    })
  }
}

function setGameConfig(replay, user, settings) {
  const player = new Slot({ type: 'human', name: user.name, id: cuid(), teamId: 0 })
  const slots = List.of(player)

  return activeGameManager.setGameConfig({
    lobby: {
      name: replay.name,
      map: { isReplay: true, path: replay.path },
      gameType: 'melee',
      numSlots: 4,
      slots,
      host: player,
    },
    settings,
    localUser: user,
  })
}

function setGameRoutes(gameId) {
  activeGameManager.setGameRoutes(gameId, [])
}

export function startReplay(replay) {
  return (dispatch, getState) => {
    const { auth: { user }, settings } = getState()

    dispatch({
      type: REPLAYS_START_REPLAY,
      payload: replay,
    })

    const gameId = setGameConfig(replay, user, settings)
    setGameRoutes(gameId)
    dispatch(routerActions.push('/active-game'))
  }
}

export function changePath(browseId, path) {
  return {
    type: REPLAYS_CHANGE_PATH,
    payload: {
      browseId,
      path,
    },
  }
}
