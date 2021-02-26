import fs from 'fs'
import { push } from 'connected-react-router'
import { List } from 'immutable'
import cuid from 'cuid'
import ReplayParser from 'jssuh'
import logger from '../logging/logger'
import activeGameManager from '../active-game/active-game-manager-instance'
import { openSimpleDialog } from '../dialogs/action-creators'
import { Slot } from '../lobbies/lobby-reducer'
import { makeServerUrl } from '../network/server-url'
import { REPLAYS_START_REPLAY } from '../actions'

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
  const player = new Slot({
    type: 'human',
    name: user.name,
    id: cuid(),
    teamId: 0,
    userId: user.id,
  })
  const slots = List.of(player)

  const header = await getReplayHeader(replay.path)

  return activeGameManager.setGameConfig({
    settings,
    localUser: user,
    setup: {
      gameId: cuid(),
      name: replay.name,
      map: { isReplay: true, path: replay.path },
      gameType: 'melee',
      numSlots: 4,
      slots,
      host: player,
      seed: header.seed,
      resultCode: '',
      serverUrl: makeServerUrl(''),
    },
  })
}

function setGameRoutes(gameId) {
  activeGameManager.setGameRoutes(gameId, [])
  activeGameManager.allowStart(gameId)
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

    // TODO(2Pac): Use the game loader on the server to register watching a replay, so we can show
    // to other people (like their friends) when a user is watching a replay.
    setGameConfig(replay, user, settings).then(
      gameId => {
        setGameRoutes(gameId)
        dispatch(push('/active-game'))
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
