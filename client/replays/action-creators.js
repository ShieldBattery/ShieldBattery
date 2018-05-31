import fs from 'fs'
import { routerActions } from 'react-router-redux'
import { List } from 'immutable'
import cuid from 'cuid'
import ReplayParser from 'jssuh'
import logger from '../logging/logger'
import readFolder from './get-files'
import activeGameManager from '../active-game/active-game-manager-instance'
import { openSimpleDialog } from '../dialogs/dialog-action-creator'
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

function getReplayHeader(filePath) {
  return new Promise((resolve, reject) => {
    const fileStream = fs.createReadStream(filePath)
    fileStream.on('error', reject)

    const parser = new ReplayParser()
    parser.on('replayHeader', resolve).on('error', reject)

    fileStream.pipe(parser)
    parser.resume()
  })
}

async function setGameConfig(replay, user, settings) {
  const player = new Slot({ type: 'human', name: user.name, id: cuid(), teamId: 0 })
  const slots = List.of(player)

  const header = await getReplayHeader(replay.path)

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
    setup: {
      seed: header.seed,
    },
  })
}

function setGameRoutes(gameId) {
  activeGameManager.setGameRoutes(gameId, [])
}

export function startReplay(replay) {
  return (dispatch, getState) => {
    const {
      auth: { user },
      settings,
    } = getState()

    dispatch({
      type: REPLAYS_START_REPLAY,
      payload: replay,
    })

    setGameConfig(replay, user, settings).then(
      gameId => {
        setGameRoutes(gameId)
        dispatch(routerActions.push('/active-game'))
      },
      err => {
        logger.error(`Error starting replay file [${replay.path}]: ${err}`)
        dispatch(
          openSimpleDialog(
            'Error loading replay',
            'The selected replay could not be loaded. It may either be corrupt, or was created ' +
              'by a version of StarCraft newer than is currently supported.',
          ),
        )
      },
    )
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
