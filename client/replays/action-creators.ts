import { nanoid } from 'nanoid'
import { PlayerInfo } from '../../common/games/game-launch-config'
import { GameType } from '../../common/games/game-type'
import { GameReplayInfo } from '../../common/games/games'
import { ReplaySaveOrganize, TypedIpcRenderer } from '../../common/ipc'
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

/**
 * A destination from the "Save replay" menu. Every destination downloads the replay identically
 * (or reuses what's already indexed/on disk); only the logical organization differs.
 */
export type SaveReplayDestination =
  | { kind: 'library' }
  | { kind: 'bookmarks' }
  | { kind: 'playlist'; playlistId: number; playlistName: string }

/** Result of `saveReplayToLibrary`, rich enough for a caller to build a snackbar and an Undo. */
export interface SaveReplayResult {
  /** True if this game's replay was already present in the local library (indexed or on disk). */
  alreadySaved: boolean
  /** The destination this call saved/organized into. */
  destination: SaveReplayDestination
  /**
   * Whether `destination`'s bookmark/playlist flag actually took effect. Always `true` for
   * `library` (being saved/already-in-the-library is all that destination asks for); for
   * `bookmarks`/`playlist` this can be `false` if the file couldn't be indexed in time to apply it.
   */
  organized: boolean
  /**
   * Reverses this call's effect, when doing so is safe and meaningful: deletes the file for a
   * fresh save (never for a file that already existed on disk before this call), or un-applies the
   * bookmark/playlist flag when the destination only added one to an already-saved replay.
   * Omitted when there's nothing sensible to undo (e.g. picking `library` on an already-saved
   * replay).
   */
  undo?: () => Promise<void>
}

/**
 * Downloads a replay from the server (if not already indexed locally) and saves it into the
 * watched replay library folder, so the local replay library picks it up -- then applies
 * `destination`'s organization (bookmark it, or file it into a playlist). Unlike
 * `watchReplayFromUrl`, this writes into the user-visible watched folder rather than the per-id
 * cache used for playback.
 *
 * When the replay is already indexed, no download/save happens at all: `library` is a no-op
 * (it's already there), while `bookmarks`/`playlist` apply their flag directly via the existing
 * replay's id.
 */
export function saveReplayToLibrary(
  replayInfo: GameReplayInfo,
  destination: SaveReplayDestination,
  spec: RequestHandlingSpec<SaveReplayResult>,
): ThunkAction {
  return abortableThunk(spec, async () => {
    const existingId = await ipcRenderer.invoke('replayLibraryFindByGameId', replayInfo.gameId)
    if (existingId !== undefined) {
      if (destination.kind === 'library') {
        return { alreadySaved: true, destination, organized: true }
      } else if (destination.kind === 'bookmarks') {
        await ipcRenderer.invoke('replayLibrarySetBookmarked', existingId, true)
        return {
          alreadySaved: true,
          destination,
          organized: true,
          undo: async () => {
            await ipcRenderer.invoke('replayLibrarySetBookmarked', existingId, false)
          },
        }
      } else {
        await ipcRenderer.invoke('replayLibraryAddToPlaylist', destination.playlistId, [existingId])
        return {
          alreadySaved: true,
          destination,
          organized: true,
          undo: async () => {
            await ipcRenderer.invoke('replayLibraryRemoveFromPlaylist', destination.playlistId, [
              existingId,
            ])
          },
        }
      }
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

    let organize: ReplaySaveOrganize | undefined
    if (destination.kind === 'bookmarks') {
      organize = { bookmark: true }
    } else if (destination.kind === 'playlist') {
      organize = { playlistId: destination.playlistId }
    }

    const saveResult = await ipcRenderer.invoke(
      'replayLibrarySaveReplay',
      replayInfo.gameId,
      replayInfo.filename,
      replayInfo.hash,
      data,
      organize,
    )
    if (!saveResult) {
      throw new Error('Failed to save replay')
    }

    // The file can already exist on disk while its game id isn't indexed yet (the watcher hasn't
    // caught up, or the index was reset) -- surface that as "already saved" rather than a fresh
    // save, and never delete it on undo (it wasn't this call that created it).
    const { path: savedPath, alreadyExists, replayId, organized: flagsApplied } = saveResult
    const organized = destination.kind === 'library' ? true : flagsApplied

    let undo: (() => Promise<void>) | undefined
    if (!alreadyExists) {
      undo = async () => {
        await ipcRenderer.invoke('replayLibraryRemoveSavedReplay', savedPath, replayInfo.hash)
      }
    } else if (organized && replayId !== undefined) {
      if (destination.kind === 'bookmarks') {
        undo = async () => {
          await ipcRenderer.invoke('replayLibrarySetBookmarked', replayId, false)
        }
      } else if (destination.kind === 'playlist') {
        const playlistId = destination.playlistId
        undo = async () => {
          await ipcRenderer.invoke('replayLibraryRemoveFromPlaylist', playlistId, [replayId])
        }
      }
    }

    return { alreadySaved: alreadyExists, destination, organized, undo }
  })
}
