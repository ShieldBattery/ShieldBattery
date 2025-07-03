import { lazy, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SbMapId } from '../../common/maps'
import { useTrackPageView } from '../analytics/analytics'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { useStableCallback } from '../react/state-hooks'
import { useAppDispatch } from '../redux-hooks'
import { CenteredContentContainer } from '../styles/centered-container'
import { BrowseServerMaps } from './browse-server-maps'

const LoadableLocalMaps = lazy(async () => ({
  default: (await import('./browse-local-maps')).BrowseLocalMaps,
}))

export function MapsRoot() {
  useTrackPageView('/maps')
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  const [browsingLocalMaps, setBrowsingLocalMaps] = useState(false)
  const [uploadedMapId, setUploadedMapId] = useState<SbMapId>()

  const onBrowseLocalMaps = useStableCallback(() => {
    setBrowsingLocalMaps(true)
    setUploadedMapId(undefined)
  })

  const onMapUpload = useStableCallback((mapId: SbMapId) => {
    setBrowsingLocalMaps(false)
    setUploadedMapId(mapId)
  })

  const onMapRemove = useStableCallback((mapId: SbMapId) => {
    if (uploadedMapId === mapId) {
      setUploadedMapId(undefined)
    }
  })

  return (
    <CenteredContentContainer>
      {IS_ELECTRON && browsingLocalMaps ? (
        <LoadableLocalMaps onMapUpload={onMapUpload} />
      ) : (
        <BrowseServerMaps
          key={uploadedMapId ?? '-'}
          title={t('maps.activity.title', 'Maps')}
          uploadedMapId={uploadedMapId}
          onBrowseLocalMaps={IS_ELECTRON ? onBrowseLocalMaps : undefined}
          onMapClick={(mapId: SbMapId) => {
            dispatch(openDialog({ type: DialogType.MapDetails, initData: { mapId } }))
          }}
          onMapRemove={onMapRemove}
        />
      )}
    </CenteredContentContainer>
  )
}
