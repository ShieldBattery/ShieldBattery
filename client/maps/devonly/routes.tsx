import { DevSection } from '../../debug/dev-section'
import { MapPageTest } from './map-page-test'
import { MapSearchTest } from './map-search-test'
import { MapSpawnsTest } from './map-spawns-test'

export function DevMaps() {
  return (
    <DevSection
      baseUrl='/dev/maps'
      routes={[
        ['Map page', 'page', MapPageTest],
        ['Map search', 'search', MapSearchTest],
        ['Map spawns', 'spawns', MapSpawnsTest],
      ]}
    />
  )
}
