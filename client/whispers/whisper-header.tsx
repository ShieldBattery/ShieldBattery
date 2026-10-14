import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { SbUserId } from '../../common/users/sb-user-id'
import { ConnectedAvatar } from '../avatars/avatar'
import { ChatHeaderRoot } from '../chat/channel-header'
import { MaterialIcon } from '../icons/material/material-icon'
import { IconButton } from '../material/button'
import { useAppSelector } from '../redux-hooks'
import {
  FriendActivityStatusLine,
  getActivityDescriptor,
  useFriendActivityStatus,
} from '../social/friend-activity-status'
import { labelLarge, singleLine, titleLarge } from '../styles/typography'
import { getAvailabilityLabel, useUserAvailability } from '../users/availability'
import { ConnectedUserContextMenu } from '../users/user-context-menu'
import { useUserOverlays } from '../users/user-overlays'
import { WhisperConversationUserMenu } from './whisper-menu-items'

const IdentityContainer = styled.div`
  min-width: 0;
  flex-grow: 1;

  display: flex;
  align-items: center;
  gap: 16px;
`

const StyledAvatar = styled(ConnectedAvatar)`
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  --availability-dot-ring: var(--theme-container-low);
`

const Username = styled.div`
  ${titleLarge};
  ${singleLine};
  flex-shrink: 0;
`

const AvailabilityText = styled.div`
  ${labelLarge};
  ${singleLine};
  color: var(--theme-on-surface-variant);
`

const StyledIconButton = styled(IconButton)`
  flex-shrink: 0;
  color: var(--theme-on-surface-variant);
`

/**
 * What the user is up to, as far as this client knows: a friend's activity (in a game, in a
 * lobby, ...) when they're doing something, otherwise their availability, otherwise nothing.
 */
export function UserStatusText({ userId, className }: { userId: SbUserId; className?: string }) {
  const { t } = useTranslation()
  const activity = useFriendActivityStatus(userId)
  const availability = useUserAvailability(userId)

  if (getActivityDescriptor(activity, t)) {
    return <FriendActivityStatusLine userId={userId} />
  }
  return availability ? (
    <AvailabilityText className={className}>
      {getAvailabilityLabel(availability.availability, t)}
    </AvailabilityText>
  ) : null
}

/** The bar across the top of a whisper conversation, saying who it's with. */
export function WhisperHeader({ userId }: { userId: SbUserId }) {
  const { t } = useTranslation()
  const username = useAppSelector(s => s.users.byId.get(userId)?.name)
  const { contextMenuProps, onContextMenu } = useUserOverlays({
    userId,
    UserMenu: WhisperConversationUserMenu,
  })

  return (
    <ChatHeaderRoot $hasActions={false}>
      <ConnectedUserContextMenu {...contextMenuProps} />
      <IdentityContainer>
        <StyledAvatar userId={userId} showAvailability={true} />
        <Username>{username}</Username>
        <UserStatusText userId={userId} />
      </IdentityContainer>
      <StyledIconButton
        icon={<MaterialIcon icon='more_vert' />}
        title={t('whispers.header.moreActions', 'More actions')}
        onClick={onContextMenu}
      />
    </ChatHeaderRoot>
  )
}
