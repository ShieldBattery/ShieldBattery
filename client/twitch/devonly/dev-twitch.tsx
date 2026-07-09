import { DevSection } from '../../debug/dev-section'
import { LiveStreamsTest } from './live-streams-test'

export function DevTwitch() {
  return (
    <DevSection
      baseUrl='/dev/twitch'
      routes={[['Live streams', 'live-streams', LiveStreamsTest]]}
    />
  )
}
