import { DevSection } from '../../debug/dev-section'
import { ChatDisplayModesTest } from '../../messaging/devonly/chat-display-modes-test'
import { ChatCardsTest } from './chat-cards-test'
import { PresenceListTest } from './presence-list-test'
import { RoleBadgesTest } from './role-badges-test'

export function DevChat() {
  return (
    <DevSection
      baseUrl='/dev/chat'
      routes={[
        ['Presence list', 'presence-list', PresenceListTest],
        ['Chat cards', 'cards', ChatCardsTest],
        ['Role badges', 'role-badges', RoleBadgesTest],
        ['Display modes', 'display-modes', ChatDisplayModesTest],
      ]}
    />
  )
}
