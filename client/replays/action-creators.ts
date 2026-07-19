import { nanoid } from 'nanoid'
import { PlayerInfo } from '../../common/games/game-launch-config'
import { GameType } from '../../common/games/game-type'
import { GameReplayInfo } from '../../common/games/games'
import { TypedIpcRenderer } from '../../common/ipc'
import { SlotType } from '../../common/lobbies/slot'
import { SbUser, SelfUserJson } from '../../common/users/sb-user'
import { makeSbUserId, SbUserId } from '../../common/users/sb-user-id'
import { openDialog, openSimpleDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { ThunkAction } from '../dispatch-registry'
import i18n from '../i18n/i18next'
import logger from '../logging/logger'
import { abortableThunk, RequestHandlingSpec } from '../network/abortable-thunk'
import { fetchRaw } from '../network/fetch'
import { makeServerUrl } from '../network/server-url'
import { ensureRelationshipsLoaded } from '../social/action-creators'
import { healthChecked } from '../starcraft/health-checked'

const ipcRenderer = new TypedIpcRenderer()

async function setGameConfig(
  replay: { name: string; path: string },
  user?: SelfUserJson,
  blockedUsers: SbUserId[] = [],
) {
  const player: PlayerInfo = {
    type: SlotType.Human,
    typeId: 6,
    id: nanoid(),
    teamId: 0,
    userId: user?.id ?? makeSbUserId(0),
  }
  const slots = [player]

  const header = (await ipcRenderer.invoke('replayParseMetadata', replay.path))?.headerData

  const localUser: SbUser = {
    id: user?.id ?? makeSbUserId(0),
    name: user?.name ?? 'ShieldBattery User',
    created: user?.created ?? 0,
  }

  return ipcRenderer.invoke('activeGameSetConfig', {
    localUser,
    blockedUsers,
    serverConfig: {
      serverUrl: makeServerUrl(''),
    },
    setup: {
      gameId: nanoid(),
      name: replay.name,
      map: { isReplay: true, path: replay.path },
      gameType: GameType.Melee,
      gameSubType: 0,
      slots,
      host: player,
      users: [localUser],
      seed: header?.startTime ?? 0,
    },
  })
}

export function startReplay({
  path,
  name = 'Replay',
}: {
  path: string
  name?: string
}): ThunkAction {
  return healthChecked((dispatch, getState) => {
    // Relationship state (the block list) resets on reconnect, so ensure it's loaded before reading
    // it — otherwise a replay launched right after a reconnect would hide nothing. Consistent with
    // the game-launch path in active-game/socket-handlers.ts.
    dispatch(
      ensureRelationshipsLoaded(() => {
        const {
          auth: { self },
          relationships,
        } = getState()

        // TODO(2Pac): Use the game loader on the server to register watching a replay, so we can
        // show to other people (like their friends) when a user is watching a replay.
        const blockedUsers = Array.from(relationships.blocks.keys())
        setGameConfig({ path, name }, self?.user, blockedUsers).then(
          gameId => {
            if (gameId) {
              dispatch(openDialog({ type: DialogType.ReplayLoad, initData: { gameId } }))
            }
          },
          err => {
            logger.error(`Error starting replay file [${path}]: ${err?.stack ?? err}`)
            dispatch(
              openSimpleDialog(
                i18n.t('replays.loading.initFailureTitle', 'Error loading replay'),
                i18n.t(
                  'replays.loading.initFailureBody',
                  'The selected replay could not be loaded. It may either be corrupt, or was ' +
                    'created by a version of StarCraft newer than is currently supported.',
                ),
              ),
            )
          },
        )
      }),
    )
  })
}

export function showReplayInfo(filePath: string) {
  return openDialog({ type: DialogType.ReplayInfo, initData: { filePath } })
}

/**
 * Downloads a replay from the server (if not already cached) and starts watching it.
 */
export function watchReplayFromUrl(
  replayInfo: Omit<GameReplayInfo, 'filename'>,
  gameId: string,
  spec: RequestHandlingSpec,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    // Check if replay is already cached
    let replayPath = await ipcRenderer.invoke('replayStoreGetPath', replayInfo.id, replayInfo.hash)

    if (!replayPath) {
      // Download the replay
      const response = await fetchRaw(replayInfo.url, {
        signal: spec.signal,
        credentials: 'same-origin',
        headers: { Accept: '*/*' },
      })
      if (!response.ok) {
        throw new Error(`Failed to download replay: ${response.status} ${response.statusText}`)
      }
      const data = await response.arrayBuffer()

      // Store in cache
      replayPath = await ipcRenderer.invoke(
        'replayStoreStoreReplay',
        replayInfo.id,
        replayInfo.hash,
        data,
      )
    }

    if (replayPath) {
      dispatch(startReplay({ path: replayPath, name: `Replay ${gameId}` }))
    }
  })
}

/** Result of `saveReplayToLibrary`, distinguishing a fresh save from a pre-existing one. */
export interface SaveReplayResult {
  /**
   * Absolute path of the saved (or already-on-disk) file. Omitted only when the replay was already
   * indexed locally, so no download or save was attempted.
   */
  path?: string
  /** True if this game's replay was already present in the local library (indexed or on disk). */
  alreadySaved: boolean
}

/**
 * Downloads a replay from the server (if not already indexed locally) and saves it into the
 * watched replay library folder, so the local replay library picks it up. Unlike
 * `watchReplayFromUrl`, this writes into the user-visible watched folder rather than the per-id
 * cache used for playback.
 */
export function saveReplayToLibrary(
  replayInfo: GameReplayInfo,
  spec: RequestHandlingSpec<SaveReplayResult>,
): ThunkAction {
  return abortableThunk(spec, async () => {
    const existingId = await ipcRenderer.invoke('replayLibraryFindByGameId', replayInfo.gameId)
    if (existingId !== undefined) {
      return { alreadySaved: true }
    }

    const response = await fetchRaw(replayInfo.url, {
      signal: spec.signal,
      credentials: 'same-origin',
      headers: { Accept: '*/*' },
    })
    if (!response.ok) {
      throw new Error(`Failed to download replay: ${response.status} ${response.statusText}`)
    }
    const data = await response.arrayBuffer()

    const saveResult = await ipcRenderer.invoke(
      'replayLibrarySaveReplay',
      replayInfo.gameId,
      replayInfo.filename,
      replayInfo.hash,
      data,
    )

    // The file can already exist on disk while its game id isn't indexed yet (the watcher hasn't
    // caught up, or the index was reset) -- surface that as "already saved" rather than a fresh save.
    return { path: saveResult?.path, alreadySaved: saveResult?.alreadyExists ?? false }
  })
}
