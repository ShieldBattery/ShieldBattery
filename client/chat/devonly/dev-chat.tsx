import { DevSection } from '../../debug/dev-section'
import { ActivityPanelTest } from './activity-panel-test'

export function DevChat() {
  return (
    <DevSection
      baseUrl='/dev/chat'
      routes={[['Activity panel', 'activity-panel', ActivityPanelTest]]}
    />
  )
}
