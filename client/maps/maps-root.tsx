import { lazy, Suspense } from 'react'
import { useRoute } from 'wouter'
import { ALL_MAP_CATALOG_TABS, MAP_COMPARE_SEGMENT, MapCatalogTab } from '../../common/map-url'
import { LoadingDotsArea } from '../progress/dots'
import { MapCatalogRedirect, MapCatalogRoute } from './map-catalog'

const LoadableMapPage = lazy(async () => ({
  default: (await import('./map-page')).MapPageRoute,
}))

const LoadableMapComparePage = lazy(async () => ({
  default: (await import('./map-compare-page')).MapComparePageRoute,
}))

export function MapsRoot() {
  const [isCatalogTab, params] = useRoute('/maps/:tab')
  const [isComparePage] = useRoute(`/maps/${MAP_COMPARE_SEGMENT}/*?`)
  const [isMapPage] = useRoute('/maps/:id/:slug?/:subPage?')

  if (isComparePage) {
    return (
      <Suspense fallback={<LoadingDotsArea />}>
        <LoadableMapComparePage />
      </Suspense>
    )
  } else if (isCatalogTab && ALL_MAP_CATALOG_TABS.includes(params.tab as MapCatalogTab)) {
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
