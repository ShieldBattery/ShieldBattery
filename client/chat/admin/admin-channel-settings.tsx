import { BasicChannelInfo, DetailedChannelInfo, JoinedChannelInfo } from '../../../common/chat'
import { ChannelSettings, ChannelSettingsOverlay } from '../channel-settings/channel-settings'

/**
 * The channel settings screen as opened from a channel's admin view, for staff moderating channels
 * they aren't a member of. Every settings page is available here.
 */
export function AdminChannelSettings({
  isOpen,
  basicChannelInfo,
  detailedChannelInfo,
  joinedChannelInfo,
  onCloseSettings,
}: {
  isOpen: boolean
  basicChannelInfo: BasicChannelInfo
  detailedChannelInfo?: DetailedChannelInfo
  joinedChannelInfo?: JoinedChannelInfo
  onCloseSettings: () => void
}) {
  return (
    <ChannelSettingsOverlay isOpen={isOpen}>
      <ChannelSettings
        basicChannelInfo={basicChannelInfo}
        detailedChannelInfo={detailedChannelInfo}
        joinedChannelInfo={joinedChannelInfo}
        canAccessGeneralPage={true}
        canAccessPermissionsPage={true}
        canAccessBannedUsersPage={true}
        onCloseSettings={onCloseSettings}
      />
    </ChannelSettingsOverlay>
  )
}
