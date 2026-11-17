import { DevSection } from '../../debug/dev-section'
import { PlayAloneTest } from './play-alone-test'

export function DevSoloGames() {
  return (
    <DevSection
      baseUrl='/dev/solo-games'
      routes={[['Play alone dialog', 'play-alone', PlayAloneTest]]}
    />
  )
}
