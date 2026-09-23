import { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import {
  AvailabilityInfo,
  DEFAULT_AVAILABILITY_INFO,
  UserAvailability,
} from '../../common/users/availability'
import { FriendActivityStatus } from '../../common/users/relationships'
import { SbUserId } from '../../common/users/sb-user-id'
import { Tooltip } from '../material/tooltip'
import { useAppSelector } from '../redux-hooks'
import { RootState } from '../root-reducer'
import { bodyMedium, singleLine } from '../styles/typography'

/**
 * Whether this client currently knows `userId` to be online: they're a friend reported online, or
 * they're in the active list of a channel we share. Availability is only ever delivered through
 * those two routes, so it's only current for users covered by one of them.
 */
function isKnownOnline(state: RootState, userId: SbUserId): boolean {
  const friendStatus = state.relationships.friendActivityStatus.get(userId)
  if (friendStatus !== undefined && friendStatus !== FriendActivityStatus.Offline) {
    return true
  }

  for (const users of state.chat.idToUsers.values()) {
    if (users.active.has(userId)) {
      return true
    }
  }

  return false
}

/**
 * Reads a user's current availability, or `undefined` if they're offline or this client has no
 * way of knowing it (they're not a friend and share no channel with us). The current user always
 * has one, taken from their own account settings, except that while they're set to Online it shows
 * Away if that's what the server is showing everyone else because they've gone idle.
 */
export function useUserAvailability(userId: SbUserId): AvailabilityInfo | undefined {
  const isSelf = useAppSelector(s => s.auth.self?.user.id === userId)
  const selfAvailability = useAppSelector(s => s.settings.account.availability)
  const selfStatusMessage = useAppSelector(s => s.settings.account.statusMessage)
  const knownOnline = useAppSelector(s => isKnownOnline(s, userId))
  const info = useAppSelector(s => s.availability.byUserId.get(userId))

  if (isSelf) {
    // Only an Online choice is ever shown differently. Any other choice shows up right away, rather
    // than after the server has published it.
    const availability =
      selfAvailability === UserAvailability.Online && info?.availability === UserAvailability.Away
        ? UserAvailability.Away
        : selfAvailability
    return { availability, statusMessage: selfStatusMessage }
  }

  return knownOnline ? (info ?? DEFAULT_AVAILABILITY_INFO) : undefined
}

export function getAvailabilityColor(availability: UserAvailability): string {
  switch (availability) {
    case UserAvailability.Online:
      return 'var(--theme-positive)'
    case UserAvailability.Away:
      return 'var(--theme-amber)'
    case UserAvailability.DoNotDisturb:
      return 'var(--theme-error)'
    default:
      return assertUnreachable(availability)
  }
}

export function getAvailabilityLabel(availability: UserAvailability, t: TFunction): string {
  switch (availability) {
    case UserAvailability.Online:
      return t('users.availability.online', 'Online')
    case UserAvailability.Away:
      return t('users.availability.away', 'Away')
    case UserAvailability.DoNotDisturb:
      return t('users.availability.doNotDisturb', 'Do not disturb')
    default:
      return assertUnreachable(availability)
  }
}

const DotTooltip = styled(Tooltip)`
  position: absolute;
  right: 0;
  bottom: 0;
  /* Sized relative to the avatar so it works at any avatar size, within readable bounds. */
  width: 30%;
  height: 30%;
  min-width: 10px;
  min-height: 10px;
  max-width: 14px;
  max-height: 14px;
  display: flex;
`

const Dot = styled.div<{ $color: string }>`
  width: 100%;
  height: 100%;

  background-color: ${props => props.$color};
  border-radius: 50%;
  /*
    The ring separates the dot from the avatar under it by matching the surface the avatar sits on.
    Surfaces that aren't the page background set \`--availability-dot-ring\` to their own color.
  */
  box-shadow: 0 0 0 2px
    var(--availability-dot-ring, var(--sb-color-background, var(--theme-container-lowest)));
`

/**
 * A dot anchored over the bottom-right corner of an avatar showing the user's availability, with
 * their status message as its tooltip. Must be placed inside the avatar's positioned root. Renders
 * nothing if the user's availability isn't known.
 */
export function AvailabilityDot({ userId }: { userId: SbUserId }) {
  const { t } = useTranslation()
  const info = useUserAvailability(userId)
  if (!info) {
    return null
  }

  const label = getAvailabilityLabel(info.availability, t)
  const text = info.statusMessage
    ? t('users.availability.withMessage', {
        defaultValue: '{{availability}}: {{message}}',
        availability: label,
        message: info.statusMessage,
      })
    : label

  return (
    <DotTooltip text={text} position='bottom' tabIndex={-1}>
      <Dot $color={getAvailabilityColor(info.availability)} role='img' aria-label={text} />
    </DotTooltip>
  )
}

const StatusMessageText = styled.div`
  ${bodyMedium};
  ${singleLine};
  color: var(--theme-on-surface-variant);
`

/**
 * A user's status message as its own line, for surfaces with room for it. Renders nothing if the
 * user has no message or their availability isn't known.
 */
export function StatusMessageLine({ userId, className }: { userId: SbUserId; className?: string }) {
  const info = useUserAvailability(userId)
  if (!info?.statusMessage) {
    return null
  }

  return (
    <StatusMessageText className={className} title={info.statusMessage}>
      {info.statusMessage}
    </StatusMessageText>
  )
}
