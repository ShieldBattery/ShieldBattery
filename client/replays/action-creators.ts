import cuid from 'cuid'
import fs from 'fs'
import ReplayParser from 'jssuh'
import pathApi from 'path'
import { PlayerInfo } from '../../common/game-launch-config'
import { GameType } from '../../common/games/configuration'
import { TypedIpcRenderer } from '../../common/ipc'
import { SlotType } from '../../common/lobbies/slot'
import { makeSbUserId } from '../../common/users/user-info'
import { REPLAYS_START_REPLAY } from '../actions'
import { SelfUserRecord } from '../auth/auth-records'
import { openSimpleDialog } from '../dialogs/action-creators'
import { ThunkAction } from '../dispatch-registry'
import logger from '../logging/logger'
import { push } from '../navigation/routing'
import { makeServerUrl } from '../network/server-url'

const ipcRenderer = new TypedIpcRenderer()

class ReplayFile {
  static fromPath(path: string): ReplayFile {
    return {
      path,
      name: pathApi.basename(path, 'rep'),
    }
  }

  path = ''
  name = ''

  constructor(path = '', name = '') {
    this.name = name
    this.path = path
  }
}

// TODO(tec27): Tighten up the types in here once the dependencies and actions have been migrated
// to TS
function getReplayHeader(filePath: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const fileStream = fs.createReadStream(filePath)
    fileStream.on('error', reject)

    const parser = new ReplayParser()
    parser.on('replayHeader', resolve).on('error', reject)

    fileStream.pipe(parser)
    parser.resume()
  })
}

async function setGameConfig(replay: ReplayFile, user: SelfUserRecord) {
  const player: PlayerInfo = {
    type: SlotType.Human,
    typeId: 6,
    name: user.name,
    id: cuid(),
    teamId: 0,
    userId: user.id,
  }
  const slots = [player]

  const header = await getReplayHeader(replay.path)

  return ipcRenderer.invoke('activeGameSetConfig', {
    localUser: {
      id: user.id,
      name: user.name,
    },
    setup: {
      gameId: cuid(),
      name: replay.name,
      map: { isReplay: true, path: replay.path },
      gameType: GameType.Melee,
      gameSubType: 0,
      slots,
      host: player,
      seed: header.seed,
      serverUrl: makeServerUrl(''),
    },
  })
}

function setGameRoutes(gameId: string) {
  ipcRenderer.invoke('activeGameSetRoutes', gameId, [])
  ipcRenderer.invoke('activeGameStartWhenReady', gameId)
}

export function startReplay(replay: ReplayFile): ThunkAction {
  return (dispatch, getState) => {
    let {
      auth: { user },
    } = getState()

    // NOTE(T1mL3arn): This action might be dispatched when a user is not logged in,
    // so we have to construct a "dummy" user to start the replay
    if (user.id === -1) {
      user = new SelfUserRecord({ id: makeSbUserId(0), name: '-- offline user --' })
    }

    dispatch({
      type: REPLAYS_START_REPLAY,
      payload: replay,
    } as any)

    // TODO(2Pac): Use the game loader on the server to register watching a replay, so we can show
    // to other people (like their friends) when a user is watching a replay.
    setGameConfig(replay, user).then(
      gameId => {
        if (gameId) {
          setGameRoutes(gameId)
          push('/active-game')
        }
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

export function openReplay(path: string): ThunkAction {
  return startReplay(ReplayFile.fromPath(path))
}
