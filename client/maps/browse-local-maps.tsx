import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { TypedIpcRenderer } from '../../common/ipc'
import { SbMapId } from '../../common/maps'
import { FileBrowser } from '../file-browser/file-browser'
import {
  FileBrowserFileEntry,
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

export function BrowseLocalMaps({ onMapUpload }: { onMapUpload: (mapId: SbMapId) => void }) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const localStarcraftPath = useAppSelector(s => s.settings.local.starcraftPath)

  const [documentsPath, setDocumentsPath] = useState<string>('')
  const [isUploading, setIsUploading] = useState(false)

  useEffect(() => {
    getDocumentsMapsPath()
      .then(path => setDocumentsPath(path))
      .catch(swallowNonBuiltins)
  }, [])

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
      rootFolders={{
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
      }}
      fileEntryConfig={{
        icon: <MaterialIcon icon='map' />,
        allowedExtensions: ['scm', 'scx'],
        onSelect: (map: FileBrowserFileEntry) => {
          setIsUploading(true)
          dispatch(
            uploadLocalMap(map.path, {
              onSuccess: ({ map }) => {
                setIsUploading(false)
                onMapUpload(map.id)
              },
              onError: () => {
                setIsUploading(false)
              },
            }),
          )
        },
      }}
    />
  )
}
