import { DevSection } from '../../debug/dev-section'
import { MapSearchTest } from './map-search-test'
import { MapSpawnMarkersTest } from './map-spawn-markers-test'
import { MapSpawnsTest } from './map-spawns-test'

export function DevMaps() {
  return (
    <DevSection
      baseUrl='/dev/maps'
      routes={[
        ['Map search', 'search', MapSearchTest],
        ['Map spawns', 'spawns', MapSpawnsTest],
        ['Spawn markers', 'spawn-markers', MapSpawnMarkersTest],
      ]}
    />
  )
}
