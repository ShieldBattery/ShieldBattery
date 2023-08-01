import cuid from 'cuid'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { PlayerInfo } from '../../common/game-launch-config'
import { GameType } from '../../common/games/configuration'
import { TypedIpcRenderer } from '../../common/ipc'
import { SlotType } from '../../common/lobbies/slot'
import { SelfUser, makeSbUserId } from '../../common/users/sb-user'
import { openDialog, openSimpleDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { ThunkAction } from '../dispatch-registry'
import i18n from '../i18n/i18next'
import logger from '../logging/logger'
import { makeServerUrl } from '../network/server-url'

const ipcRenderer = new TypedIpcRenderer()

async function setGameConfig(replay: { name: string; path: string }, user?: SelfUser) {
  const player: PlayerInfo = {
    type: SlotType.Human,
    typeId: 6,
    name: user?.name ?? 'ShieldBattery User',
    id: cuid(),
    teamId: 0,
    userId: user?.id ?? 0,
  }
  const slots = [player]

  const header = (await ipcRenderer.invoke('replayParseMetadata', replay.path))?.headerData

  return ipcRenderer.invoke('activeGameSetConfig', {
    localUser: {
      id: user?.id ?? makeSbUserId(0),
      name: user?.name ?? 'ShieldBattery User',
    },
    setup: {
      gameId: cuid(),
      name: replay.name,
      map: { isReplay: true, path: replay.path },
      gameType: GameType.Melee,
      gameSubType: 0,
      slots,
      host: player,
      seed: header?.seed ?? 0,
      serverUrl: makeServerUrl(''),
    },
  })
}

function setGameRoutes(gameId: string) {
  ipcRenderer.invoke('activeGameSetRoutes', gameId, [])?.catch(swallowNonBuiltins)
  ipcRenderer.invoke('activeGameStartWhenReady', gameId)?.catch(swallowNonBuiltins)
}

export function startReplay({
  path,
  name = 'Replay',
}: {
  path: string
  name?: string
}): ThunkAction {
  return (dispatch, getState) => {
    const {
      auth: { self },
    } = getState()

    // TODO(2Pac): Use the game loader on the server to register watching a replay, so we can show
    // to other people (like their friends) when a user is watching a replay.
    setGameConfig({ path, name }, self?.user).then(
      gameId => {
        if (gameId) {
          dispatch(openDialog({ type: DialogType.ReplayLoad, initData: { gameId } }))
          setGameRoutes(gameId)
        }
      },
      err => {
        logger.error(`Error starting replay file [${path}]: ${err?.stack ?? err}`)
        dispatch(
          openSimpleDialog(
            i18n.t('replays.loading.initFailureTitle', 'Error loading replay'),
            i18n.t(
              'replays.loading.initFailureBody',
              'The selected replay could not be loaded. It may either be corrupt, or was created ' +
                'by a version of StarCraft newer than is currently supported.',
            ),
          ),
        )
      },
    )
  }
}

export function showReplayInfo(filePath: string) {
  return openDialog({ type: DialogType.ReplayInfo, initData: { filePath } })
}
