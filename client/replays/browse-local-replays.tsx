import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { TypedIpcRenderer } from '../../common/ipc'
import { closeOverlay } from '../activities/action-creators'
import { FileBrowser } from '../file-browser/file-browser'
import {
  FileBrowserFileEntry,
  FileBrowserRootFolderId,
  FileBrowserType,
} from '../file-browser/file-browser-types'
import Replay from '../icons/material/ic_movie_black_24px.svg'
import { useAppDispatch } from '../redux-hooks'
import { startReplay } from './action-creators'

const ipcRenderer = new TypedIpcRenderer()

async function getReplayFolderPath() {
  return [await ipcRenderer.invoke('pathsGetDocumentsPath'), 'Starcraft', 'maps', 'replays'].join(
    '\\',
  )
}

export function BrowseLocalReplays() {
  const dispatch = useAppDispatch()
  const [replayFolderPath, setReplayFolderPath] = useState<string>('')

  useEffect(() => {
    getReplayFolderPath().then(path => setReplayFolderPath(path))
  }, [])

  const onStartReplay = useCallback(
    (replay: FileBrowserFileEntry) => {
      dispatch(closeOverlay() as any)
      dispatch(startReplay(replay))
    },
    [dispatch],
  )

  const fileTypes = useMemo(
    () => ({
      rep: { icon: <Replay />, onSelect: onStartReplay },
    }),
    [onStartReplay],
  )
  const rootFolders = useMemo(
    () => ({
      default: {
        id: FileBrowserRootFolderId.Default,
        name: 'Replays',
        path: replayFolderPath,
      },
    }),
    [replayFolderPath],
  )

  if (!replayFolderPath) {
    return null
  }

  return (
    <FileBrowser
      browserType={FileBrowserType.Replays}
      title='Local Replays'
      rootFolders={rootFolders}
      fileTypes={fileTypes}
    />
  )
}
