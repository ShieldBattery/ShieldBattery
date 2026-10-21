import { lazy, Suspense } from 'react'
import { useRoute } from 'wouter'
import { ALL_MAP_CATALOG_TABS, MapCatalogTab } from '../../common/map-url'
import { LoadingDotsArea } from '../progress/dots'
import { MapCatalogRedirect, MapCatalogRoute } from './map-catalog'

const LoadableMapPage = lazy(async () => ({
  default: (await import('./map-page')).MapPageRoute,
}))

export function MapsRoot() {
  const [isCatalogTab, params] = useRoute('/maps/:tab')
  const [isMapPage] = useRoute('/maps/:id/:slug?/:subPage?')

  if (isCatalogTab && ALL_MAP_CATALOG_TABS.includes(params.tab as MapCatalogTab)) {
    return <MapCatalogRoute tab={params.tab as MapCatalogTab} />
  } else if (isMapPage) {
    return (
      <Suspense fallback={<LoadingDotsArea />}>
        <LoadableMapPage />
      </Suspense>
    )
  } else {
    return <MapCatalogRedirect />
  }
}
