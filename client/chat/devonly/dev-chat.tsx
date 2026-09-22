import { DevSection } from '../../debug/dev-section'
import { ActivityPanelTest } from './activity-panel-test'
import { RoleBadgesTest } from './role-badges-test'

export function DevChat() {
  return (
    <DevSection
      baseUrl='/dev/chat'
      routes={[
        ['Activity panel', 'activity-panel', ActivityPanelTest],
        ['Role badges', 'role-badges', RoleBadgesTest],
      ]}
    />
  )
}
