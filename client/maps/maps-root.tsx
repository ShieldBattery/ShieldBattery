import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ReadonlyDeep } from 'type-fest'
import { MapInfoJson } from '../../common/maps'
import { useTrackPageView } from '../analytics/analytics'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { useStableCallback } from '../react/state-hooks'
import { useAppDispatch } from '../redux-hooks'
import { CenteredContentContainer } from '../styles/centered-container'
import { BrowseServerMaps } from './browse-server-maps'

const LoadableLocalMaps = React.lazy(async () => ({
  default: (await import('./browse-local-maps')).BrowseLocalMaps,
}))

export function MapsRoot() {
  useTrackPageView('/maps')
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const [browsingLocalMaps, setBrowsingLocalMaps] = useState(false)
  const [uploadedMap, setUploadedMap] = useState<ReadonlyDeep<MapInfoJson>>()

  const onBrowseLocalMaps = useStableCallback(() => {
    setBrowsingLocalMaps(true)
    setUploadedMap(undefined)
  })

  const onMapUpload = useStableCallback((map: ReadonlyDeep<MapInfoJson>) => {
    setBrowsingLocalMaps(false)
    setUploadedMap(map)
  })
  const onMapDetails = useStableCallback((map: ReadonlyDeep<MapInfoJson>) => {
    dispatch(openDialog({ type: DialogType.MapDetails, initData: { mapId: map.id } }))
  })

  return (
    <CenteredContentContainer>
      {IS_ELECTRON && browsingLocalMaps ? (
        <LoadableLocalMaps onMapSelect={onMapUpload} />
      ) : (
        <BrowseServerMaps
          key={uploadedMap?.id ?? '-'}
          title={t('maps.activity.title', 'Maps')}
          uploadedMap={uploadedMap}
          onBrowseLocalMaps={IS_ELECTRON ? onBrowseLocalMaps : undefined}
          onMapDetails={onMapDetails}
          onMapSelect={onMapDetails}
        />
      )}
    </CenteredContentContainer>
  )
}
