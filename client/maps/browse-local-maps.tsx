import React, { useCallback, useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'
import { TypedIpcRenderer } from '../../common/ipc'
import { MapInfoJson } from '../../common/maps'
import { ActivityBackButton } from '../activities/activity-back-button'
import { FileBrowser } from '../file-browser/file-browser'
import {
  FileBrowserFileEntry,
  FileBrowserRootFolderId,
  FileBrowserType,
} from '../file-browser/file-browser-types'
import MapIcon from '../icons/material/ic_terrain_black_24px.svg'
import LoadingIndicator from '../progress/dots'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { openSnackbar, TIMING_LONG } from '../snackbars/action-creators'
import { uploadLocalMap } from './action-creators'

const LoadingArea = styled.div`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  height: 100%;
`

const ipcRenderer = new TypedIpcRenderer()

async function getDocumentsMapsPath() {
  return [await ipcRenderer.invoke('pathsGetDocumentsPath'), 'Starcraft', 'maps'].join('\\')
}

export function BrowseLocalMaps(props: { onMapSelect: (map: MapInfoJson) => void }) {
  const dispatch = useAppDispatch()
  const lastUploadError = useAppSelector(s => s.localMaps.lastError)
  const isUploading = useAppSelector(s => s.localMaps.isUploading)
  const localStarcraftPath = useAppSelector(s => s.settings.local.starcraftPath)
  const [documentsPath, setDocumentsPath] = useState<string>('')

  useEffect(() => {
    getDocumentsMapsPath().then(path => setDocumentsPath(path))
  }, [])

  useEffect(() => {
    if (lastUploadError) {
      dispatch(
        openSnackbar({ message: 'There was a problem uploading the map', time: TIMING_LONG }),
      )
    }
  }, [dispatch, lastUploadError])

  const onMapSelect = useCallback(
    (map: FileBrowserFileEntry) => {
      dispatch(uploadLocalMap(map.path, props.onMapSelect))
    },
    [dispatch, props.onMapSelect],
  )

  const fileTypes = useMemo(
    () => ({
      scm: { icon: <MapIcon />, onSelect: onMapSelect },
      scx: { icon: <MapIcon />, onSelect: onMapSelect },
    }),
    [onMapSelect],
  )
  const rootFolders = useMemo(
    () => ({
      default: {
        id: FileBrowserRootFolderId.Default,
        name: 'Program folder',
        path: [localStarcraftPath, 'Maps'].join('\\'),
      },
      documents: {
        id: FileBrowserRootFolderId.Documents,
        name: 'Documents folder',
        path: documentsPath,
      },
    }),
    [documentsPath, localStarcraftPath],
  )

  if (!localStarcraftPath || !documentsPath) {
    return null
  }

  if (isUploading) {
    return (
      <LoadingArea>
        <LoadingIndicator />
      </LoadingArea>
    )
  }

  return (
    <FileBrowser
      browserType={FileBrowserType.Maps}
      title='Local Maps'
      titleButton={<ActivityBackButton />}
      rootFolders={rootFolders}
      fileTypes={fileTypes}
    />
  )
}
