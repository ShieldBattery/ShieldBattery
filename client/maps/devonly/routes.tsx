import { DevSection } from '../../debug/dev-section'
import { MapSearchTest } from './map-search-test'

export function DevMaps() {
  return <DevSection baseUrl='/dev/maps' routes={[['Map search', 'search', MapSearchTest]]} />
}
