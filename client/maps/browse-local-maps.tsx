import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { TypedIpcRenderer } from '../../common/ipc'
import { MapInfoJson } from '../../common/maps'
import { FileBrowser } from '../file-browser/file-browser'
import {
  FileBrowserFileEntry,
  FileBrowserFileEntryConfig,
  FileBrowserRootFolderId,
  FileBrowserType,
} from '../file-browser/file-browser-types'
import { MaterialIcon } from '../icons/material/material-icon'
import LoadingIndicator from '../progress/dots'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
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

export function BrowseLocalMaps(props: { onMapSelect: (map: ReadonlyDeep<MapInfoJson>) => void }) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const isUploading = useAppSelector(s => s.localMaps.isUploading)
  const localStarcraftPath = useAppSelector(s => s.settings.local.starcraftPath)
  const [documentsPath, setDocumentsPath] = useState<string>('')

  useEffect(() => {
    getDocumentsMapsPath()
      .then(path => setDocumentsPath(path))
      .catch(swallowNonBuiltins)
  }, [])

  const onMapSelect = useCallback(
    (map: FileBrowserFileEntry) => {
      dispatch(uploadLocalMap(map.path, props.onMapSelect))
    },
    [dispatch, props.onMapSelect],
  )

  const fileEntryConfig: FileBrowserFileEntryConfig = useMemo(
    () => ({
      icon: <MaterialIcon icon='map' />,
      allowedExtensions: ['scm', 'scx'],
      onSelect: onMapSelect,
    }),
    [onMapSelect],
  )
  const rootFolders = useMemo(
    () => ({
      default: {
        id: FileBrowserRootFolderId.Default,
        name: t('maps.local.programFolder', 'Program folder'),
        path: [localStarcraftPath, 'Maps'].join('\\'),
      },
      documents: {
        id: FileBrowserRootFolderId.Documents,
        name: t('maps.local.documentsFolder', 'Documents folder'),
        path: documentsPath,
      },
    }),
    [documentsPath, localStarcraftPath, t],
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

  // TODO(tec27): add back button if needed (always?)
  return (
    <FileBrowser
      browserType={FileBrowserType.Maps}
      title={t('maps.local.title', 'Local Maps')}
      rootFolders={rootFolders}
      fileEntryConfig={fileEntryConfig}
    />
  )
}
