import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Route, Switch } from 'wouter'
import { urlForMap } from '../../common/map-url'
import { SbMapId } from '../../common/maps'
import { useTrackPageView } from '../analytics/analytics'
import { push } from '../navigation/routing'
import { LoadingDotsArea } from '../progress/dots'
import { useAppSelector } from '../redux-hooks'
import { CenteredContentContainer } from '../styles/centered-container'
import { BrowseServerMaps } from './browse-server-maps'

const LoadableLocalMaps = lazy(async () => ({
  default: (await import('./browse-local-maps')).BrowseLocalMaps,
}))

const LoadableMapPage = lazy(async () => ({
  default: (await import('./map-page')).MapPageRoute,
}))

export function MapsRoot() {
  return (
    <Switch>
      <Route path='/maps/:id/:slug?/:subPage?'>
        <Suspense fallback={<LoadingDotsArea />}>
          <LoadableMapPage />
        </Suspense>
      </Route>
      <Route>
        <MapsBrowser />
      </Route>
    </Switch>
  )
}

function MapsBrowser() {
  useTrackPageView('/maps')
  const { t } = useTranslation()
  const mapsById = useAppSelector(s => s.maps.byId)

  const [browsingLocalMaps, setBrowsingLocalMaps] = useState(false)
  const [uploadedMapId, setUploadedMapId] = useState<SbMapId>()

  const onBrowseLocalMaps = () => {
    setBrowsingLocalMaps(true)
    setUploadedMapId(undefined)
  }

  const onMapUpload = (mapId: SbMapId) => {
    setBrowsingLocalMaps(false)
    setUploadedMapId(mapId)
  }

  const onMapRemove = (mapId: SbMapId) => {
    if (uploadedMapId === mapId) {
      setUploadedMapId(undefined)
    }
  }

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
            push(urlForMap(mapId, mapsById.get(mapId)?.name))
          }}
          onMapRemove={onMapRemove}
        />
      )}
    </CenteredContentContainer>
  )
}
