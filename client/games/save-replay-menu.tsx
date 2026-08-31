import type { TFunction } from 'i18next'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getErrorStack } from '../../common/errors'
import { GameReplayInfo } from '../../common/games/games'
import { TypedIpcRenderer } from '../../common/ipc'
import { ReplayPlaylist } from '../../common/replays-library'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { MaterialIcon } from '../icons/material/material-icon'
import logger from '../logging/logger'
import { Divider } from '../material/menu/divider'
import { MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { useAppDispatch } from '../redux-hooks'
import {
  SaveReplayDestination,
  SaveReplayResult,
  saveReplayToLibrary,
} from '../replays/action-creators'
import { DURATION_LONG } from '../snackbars/snackbar-durations'
import { useSnackbarController } from '../snackbars/snackbar-overlay'

const ipcRenderer = new TypedIpcRenderer()

/** Optional hooks into a save-and-organize attempt's lifecycle, for callers that track their own
 * loading/saved UI state alongside the snackbar this already shows (e.g. the results page's
 * "Saving…" button state). */
export interface SaveReplayLifecycleCallbacks {
  /**
   * Called synchronously right before dispatching, to obtain the abort signal for this attempt --
   * letting the caller cancel a still-pending previous attempt (e.g. one left over from before
   * navigating to a different game) first. Omit for an attempt that's never aborted.
   */
  getAbortSignal?: () => AbortSignal | undefined
  /** Called when the save/organize request starts. */
  onSaveStart?: () => void
  /** Called once the request settles -- with its result on success, or `undefined` on failure. */
  onSaveSettled?: (result: SaveReplayResult | undefined) => void
  /**
   * Called after a successful Undo that removed the replay from the library (i.e. a fresh save
   * was reversed by deleting its file). Not called for undos that only remove a bookmark/playlist
   * flag from a replay that remains in the library.
   */
  onUndone?: () => void
}

/**
 * Runs `saveReplayToLibrary` for `replayInfo` against a chosen destination and shows a snackbar
 * naming where the replay landed, offering Undo when the save/organize can be sensibly reversed.
 * Shared by every "Save replay" surface (the games list context menu, the side panel, the results
 * page) so the destination-to-message mapping lives in one place.
 */
export function useSaveReplayWithDestination(
  replayInfo: GameReplayInfo | undefined,
  lifecycle?: SaveReplayLifecycleCallbacks,
): (destination: SaveReplayDestination) => void {
  const dispatch = useAppDispatch()
  const { t } = useTranslation()
  const snackbarController = useSnackbarController()

  return (destination: SaveReplayDestination) => {
    if (!replayInfo) {
      return
    }

    dispatch(
      saveReplayToLibrary(replayInfo, destination, {
        signal: lifecycle?.getAbortSignal?.(),
        onStart: lifecycle?.onSaveStart,
        onSuccess: result => {
          const runUndo = result.undo
          let onUndo: (() => void) | undefined
          if (runUndo) {
            // Dismisses the actionable snackbar the moment Undo is clicked, so the button can't
            // be pressed again while (or after) the undo runs; a follow-up snackbar then reports
            // what the undo did.
            const dismissSnackbar = new AbortController()
            let undone = false
            onUndo = () => {
              if (undone) {
                return
              }
              undone = true
              dismissSnackbar.abort()

              runUndo()
                .then(() => {
                  snackbarController.showSnackbar(
                    getUndoneMessage(destination, result.alreadySaved, t),
                  )
                  if (!result.alreadySaved) {
                    lifecycle?.onUndone?.()
                  }
                })
                .catch(err => {
                  logger.error(`Error undoing replay save: ${getErrorStack(err)}`)
                  snackbarController.showSnackbar(
                    t('gameDetails.saveReplayUndoError', 'There was a problem undoing that'),
                  )
                })
            }

            snackbarController.showSnackbar(
              getSaveReplayMessage(destination, result.alreadySaved, result.organized, t),
              DURATION_LONG,
              {
                signal: dismissSnackbar.signal,
                action: { label: t('common.actions.undo', 'Undo'), onClick: onUndo },
              },
            )
          } else {
            snackbarController.showSnackbar(
              getSaveReplayMessage(destination, result.alreadySaved, result.organized, t),
              DURATION_LONG,
            )
          }
          lifecycle?.onSaveSettled?.(result)
        },
        onError: err => {
          logger.error(`Error saving replay: ${getErrorStack(err)}`)
          snackbarController.showSnackbar(
            t('gameDetails.saveReplayError', 'There was a problem saving the replay'),
          )
          lifecycle?.onSaveSettled?.(undefined)
        },
      }),
    )
  }
}

/**
 * The confirmation shown after a successful Undo. A fresh save's undo deletes the file, so it
 * reads as removal from the library regardless of the picked destination; a flag-only undo (the
 * replay was already in the library) names just the bookmark/playlist that was removed.
 */
function getUndoneMessage(
  destination: SaveReplayDestination,
  alreadySaved: boolean,
  t: TFunction,
): string {
  if (!alreadySaved) {
    return t('gameDetails.saveReplayUndoneLibrary', 'Replay removed from your library')
  }
  if (destination.kind === 'bookmarks') {
    return t('gameDetails.saveReplayUndoneBookmarks', 'Removed from your bookmarks')
  }
  if (destination.kind === 'playlist') {
    return t('gameDetails.saveReplayUndonePlaylist', {
      defaultValue: 'Removed from {{name}}',
      name: destination.playlistName,
    })
  }
  return t('gameDetails.saveReplayUndoneLibrary', 'Replay removed from your library')
}

function getSaveReplayMessage(
  destination: SaveReplayDestination,
  alreadySaved: boolean,
  organized: boolean,
  t: TFunction,
): string {
  if (destination.kind === 'library') {
    return alreadySaved
      ? t('gameDetails.saveReplayAlreadySaved', "This game's replay is already in your library")
      : t('gameDetails.saveReplaySuccess', 'Replay saved to your library')
  }

  // The file is always saved (or already was) regardless of whether the destination's flag could
  // be applied, so an organize failure still gets the plain library-save message rather than
  // claiming a bookmark/playlist placement that didn't happen.
  if (!organized) {
    return t('gameDetails.saveReplaySuccess', 'Replay saved to your library')
  }

  if (destination.kind === 'bookmarks') {
    return alreadySaved
      ? t('gameDetails.saveReplayAddedToBookmarks', 'Added to your bookmarks')
      : t('gameDetails.saveReplaySavedToBookmarks', 'Saved to your bookmarks')
  }

  return alreadySaved
    ? t('gameDetails.saveReplayAddedToPlaylist', {
        defaultValue: 'Added to {{name}}',
        name: destination.playlistName,
      })
    : t('gameDetails.saveReplaySavedToPlaylist', {
        defaultValue: 'Saved to {{name}}',
        name: destination.playlistName,
      })
}

/**
 * The "Save replay" destination menu: plain library save, bookmark it, file it into an existing
 * playlist, or create a new one. Electron-only (like every caller that renders it), since saving
 * into the local replay library is a desktop-app concept.
 */
export function SaveReplayMenuContent({
  replayInfo,
  onDismiss,
  ...lifecycle
}: {
  replayInfo: GameReplayInfo
  onDismiss: () => void
} & SaveReplayLifecycleCallbacks) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const saveWithDestination = useSaveReplayWithDestination(replayInfo, lifecycle)
  const [playlists, setPlaylists] = useState<ReplayPlaylist[]>([])

  useEffect(() => {
    let canceled = false
    ipcRenderer
      .invoke('replayLibraryListPlaylists')
      ?.then(result => {
        if (!canceled) {
          setPlaylists(result)
        }
      })
      .catch(err => {
        logger.error(`Error listing playlists: ${getErrorStack(err)}`)
      })

    return () => {
      canceled = true
    }
  }, [])

  const runSave = (destination: SaveReplayDestination) => {
    onDismiss()
    saveWithDestination(destination)
  }

  return (
    <MenuList dense={true}>
      <MenuItem
        icon={<MaterialIcon icon='save' />}
        text={t('gameDetails.saveReplayMenuLibrary', 'Library')}
        onClick={() => runSave({ kind: 'library' })}
      />
      <MenuItem
        icon={<MaterialIcon icon='bookmark' />}
        text={t('gameDetails.saveReplayMenuBookmarks', 'Bookmarks')}
        onClick={() => runSave({ kind: 'bookmarks' })}
      />
      <Divider $dense={true} />
      {playlists.map(p => (
        <MenuItem
          key={p.id}
          icon={<MaterialIcon icon='queue_music' />}
          text={p.name}
          onClick={() => runSave({ kind: 'playlist', playlistId: p.id, playlistName: p.name })}
        />
      ))}
      <MenuItem
        icon={<MaterialIcon icon='add' />}
        text={t('replays.library.newPlaylistMenu', 'New playlist…')}
        onClick={() => {
          onDismiss()
          dispatch(
            openDialog({
              type: DialogType.CreatePlaylist,
              initData: {
                onCreated: (id, name) =>
                  saveWithDestination({ kind: 'playlist', playlistId: id, playlistName: name }),
              },
            }),
          )
        }}
      />
    </MenuList>
  )
}
