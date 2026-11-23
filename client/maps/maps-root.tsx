import { lazy, Suspense, useEffect } from 'react'
import { useRoute } from 'wouter'
import {
  ALL_MAP_CATALOG_TABS,
  MAP_COLLECTIONS_SEGMENT,
  MAP_COMPARE_SEGMENT,
  MAP_FAVORITES_SEGMENT,
  MapCatalogTab,
  urlForMapCatalog,
  urlForMapCollections,
} from '../../common/map-url'
import { replace } from '../navigation/routing'
import { LoadingDotsArea } from '../progress/dots'
import { MapCatalogRoute } from './map-catalog'
import { MapCollectionsRoute } from './map-collections-tab'

const LoadableMapDiscover = lazy(async () => ({
  default: (await import('./map-discover')).MapDiscoverRoute,
}))

const LoadableMapPage = lazy(async () => ({
  default: (await import('./map-page')).MapPageRoute,
}))

const LoadableMapComparePage = lazy(async () => ({
  default: (await import('./map-compare-page')).MapComparePageRoute,
}))

const LoadableMapCollectionPage = lazy(async () => ({
  default: (await import('./map-collection-page')).MapCollectionPageRoute,
}))

/** Sends the tab that listed starred maps to the Collections tab, where Starred is listed. */
function FavoritesRedirect() {
  useEffect(() => {
    replace(urlForMapCollections())
  }, [])
  return null
}

/**
 * Sends a path under `/maps` that names nothing to the map browser's front page, keeping any
 * filters in its URL.
 */
function DiscoverRedirect() {
  useEffect(() => {
    replace(urlForMapCatalog(MapCatalogTab.Discover, location.search.slice(1)))
  }, [])
  return null
}

export function MapsRoot() {
  const [isDiscover] = useRoute('/maps')
  const [isCatalogTab, params] = useRoute('/maps/:tab')
  const [isComparePage] = useRoute(`/maps/${MAP_COMPARE_SEGMENT}/*?`)
  const [isCollectionPage] = useRoute(`/maps/${MAP_COLLECTIONS_SEGMENT}/:id/:slug?`)
  const [isMapPage] = useRoute('/maps/:id/:slug?/:subPage?')

  if (isDiscover) {
    return (
      <Suspense fallback={<LoadingDotsArea />}>
        <LoadableMapDiscover />
      </Suspense>
    )
  } else if (isComparePage) {
    return (
      <Suspense fallback={<LoadingDotsArea />}>
        <LoadableMapComparePage />
      </Suspense>
    )
  } else if (isCollectionPage) {
    return (
      <Suspense fallback={<LoadingDotsArea />}>
        <LoadableMapCollectionPage />
      </Suspense>
    )
  } else if (isCatalogTab && params.tab === MAP_FAVORITES_SEGMENT) {
    return <FavoritesRedirect />
  } else if (isCatalogTab && params.tab === MapCatalogTab.Discover) {
    return <DiscoverRedirect />
  } else if (isCatalogTab && params.tab === MapCatalogTab.Collections) {
    return <MapCollectionsRoute />
  } else if (isCatalogTab && ALL_MAP_CATALOG_TABS.includes(params.tab as MapCatalogTab)) {
    return <MapCatalogRoute tab={params.tab as MapCatalogTab} />
  } else if (isMapPage) {
    return (
      <Suspense fallback={<LoadingDotsArea />}>
        <LoadableMapPage />
      </Suspense>
    )
  } else {
    return <DiscoverRedirect />
  }
}
