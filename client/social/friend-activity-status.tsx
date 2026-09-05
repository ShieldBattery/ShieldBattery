import { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { FriendActivityStatus } from '../../common/users/relationships'
import { SbUserId } from '../../common/users/sb-user-id'
import { MaterialIcon } from '../icons/material/material-icon'
import { Tooltip } from '../material/tooltip'
import { useAppSelector } from '../redux-hooks'
import { bodySmall, inter, singleLine } from '../styles/typography'

/** Reads the current activity status of a friend, or `undefined` if they're not a friend. */
export function useFriendActivityStatus(userId: SbUserId): FriendActivityStatus | undefined {
  return useAppSelector(s => s.relationships.friendActivityStatus.get(userId))
}

interface ActivityDescriptor {
  icon: string
  color: string
  label: string
}

/**
 * Maps a friend's activity status to how it should be presented: which icon to use, what color to
 * render it in, and its label. Returns `undefined` for the states that shouldn't render anything
 * (online, offline, or not a friend at all).
 */
function getActivityDescriptor(
  status: FriendActivityStatus | undefined,
  t: TFunction,
): ActivityDescriptor | undefined {
  switch (status) {
    case FriendActivityStatus.InLobby:
      return {
        icon: 'groups',
        color: 'var(--theme-positive)',
        label: t('users.activityStatus.inLobby', 'In lobby'),
      }
    case FriendActivityStatus.InQueue:
      return {
        icon: 'search',
        color: 'var(--theme-amber)',
        label: t('users.activityStatus.inQueue', 'In queue'),
      }
    case FriendActivityStatus.InGame:
      return {
        icon: 'strategy',
        color: 'var(--color-blue80)',
        label: t('users.activityStatus.inGame', 'In game'),
      }
    default:
      return undefined
  }
}

/**
 * A full-width column layout for a name line plus an optional status line below it, used by rows
 * that show a friend's activity status underneath their name.
 */
export const NameBlock = styled.div`
  flex-grow: 1;
  min-width: 0;

  display: flex;
  flex-direction: column;
  justify-content: center;
`

export const NameLine = styled.div`
  ${singleLine};
  line-height: 20px;
`

const StatusLineRoot = styled.div<{ $color: string }>`
  ${inter};
  ${bodySmall};

  display: flex;
  align-items: center;
  gap: 4px;
  line-height: 16px;
  white-space: nowrap;
  overflow: hidden;

  color: ${props => props.$color};
`

const StatusLineIcon = styled(MaterialIcon)`
  flex-shrink: 0;
`

// `singleLine`'s `text-overflow: ellipsis` only takes effect on a block's own inline content, not
// on an anonymous flex item, so the label needs its own block-level element to truncate within the
// flex row.
const StatusLabel = styled.span`
  ${singleLine};
  min-width: 0;
`

/**
 * A single line showing a friend's current activity status (icon + label), for rows with room for
 * a second line below the name. Renders nothing if the user isn't a friend or has no active
 * status.
 */
export function FriendActivityStatusLine({
  userId,
  className,
}: {
  userId: SbUserId
  className?: string
}) {
  const { t } = useTranslation()
  const status = useFriendActivityStatus(userId)
  const descriptor = getActivityDescriptor(status, t)

  if (!descriptor) {
    return null
  }

  return (
    <StatusLineRoot className={className} $color={descriptor.color}>
      <StatusLineIcon icon={descriptor.icon} size={14} />
      <StatusLabel>{descriptor.label}</StatusLabel>
    </StatusLineRoot>
  )
}

const GlyphContainer = styled.span<{ $color: string }>`
  flex-shrink: 0;
  color: ${props => props.$color};
`

/**
 * An icon-only indicator of a friend's current activity status, for single-line rows that don't
 * have room for a text label. Renders nothing if the user isn't a friend or has no active status.
 */
export function FriendActivityStatusGlyph({
  userId,
  className,
}: {
  userId: SbUserId
  className?: string
}) {
  const { t } = useTranslation()
  const status = useFriendActivityStatus(userId)
  const descriptor = getActivityDescriptor(status, t)

  if (!descriptor) {
    return null
  }

  return (
    <GlyphContainer
      className={className}
      $color={descriptor.color}
      role='img'
      aria-label={descriptor.label}>
      <Tooltip text={descriptor.label} position='left' tabIndex={-1}>
        <MaterialIcon icon={descriptor.icon} size={16} />
      </Tooltip>
    </GlyphContainer>
  )
}
