import { DevSection } from '../../debug/dev-section'
import { MapDiscoverTest } from './map-discover-test'
import { MapOwnersTest } from './map-owners-test'
import { MapPageTest } from './map-page-test'
import { MapPublishTest } from './map-publish-test'
import { MapSearchTest } from './map-search-test'
import { MapSpawnsTest } from './map-spawns-test'
import { MapTagsTest } from './map-tags-test'
import { MapTilesTest } from './map-tiles-test'

export function DevMaps() {
  return (
    <DevSection
      baseUrl='/dev/maps'
      routes={[
        ['Discover page parts', 'discover', MapDiscoverTest],
        ['Map page', 'page', MapPageTest],
        ['Map makers', 'makers', MapOwnersTest],
        ['Publish dialog', 'publish', MapPublishTest],
        ['Map search', 'search', MapSearchTest],
        ['Map spawns', 'spawns', MapSpawnsTest],
        ['Edit tags dialog', 'tags', MapTagsTest],
        ['Map tiles', 'tiles', MapTilesTest],
      ]}
    />
  )
}
