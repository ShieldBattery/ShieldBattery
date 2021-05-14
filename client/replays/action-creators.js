import cuid from 'cuid'
import fs from 'fs'
import ReplayParser from 'jssuh'
import { TypedIpcRenderer } from '../../common/ipc'
import { REPLAYS_START_REPLAY } from '../actions'
import { openSimpleDialog } from '../dialogs/action-creators'
import { Slot } from '../lobbies/lobby-reducer'
import logger from '../logging/logger'
import { push } from '../navigation/routing'
import { makeServerUrl } from '../network/server-url'

const ipcRenderer = new TypedIpcRenderer()

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

async function setGameConfig(replay, user) {
  const player = new Slot({
    type: 'human',
    name: user.name,
    id: cuid(),
    teamId: 0,
    userId: user.id,
  }).toJS()
  const slots = [player]

  const header = await getReplayHeader(replay.path)

  return ipcRenderer.invoke('activeGameSetConfig', {
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
  ipcRenderer.invoke('activeGameSetRoutes', gameId, [])
  ipcRenderer.invoke('activeGameStartWhenReady', gameId)
}

export function startReplay(replay) {
  return (dispatch, getState) => {
    const {
      auth: { user },
    } = getState()

    dispatch({
      type: REPLAYS_START_REPLAY,
      payload: replay,
    })

    // TODO(2Pac): Use the game loader on the server to register watching a replay, so we can show
    // to other people (like their friends) when a user is watching a replay.
    setGameConfig(replay, user.toJS()).then(
      gameId => {
        setGameRoutes(gameId)
        push('/active-game')
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
