import { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { FriendActivityStatus } from '../../common/users/relationships'
import { SbUserId } from '../../common/users/sb-user-id'
import { MaterialIcon } from '../icons/material/material-icon'
import { buttonReset } from '../material/button-reset'
import { Tooltip } from '../material/tooltip'
import { useAppSelector } from '../redux-hooks'
import { bodySmall, inter, singleLine } from '../styles/typography'
import { useJoinFriendLobby } from './join-friend-lobby'

/** Reads the current activity status of a friend, or `undefined` if they're not a friend. */
export function useFriendActivityStatus(userId: SbUserId): FriendActivityStatus | undefined {
  return useAppSelector(s => s.relationships.friendActivityStatus.get(userId))
}

export interface ActivityDescriptor {
  icon: string
  color: string
  label: string
}

/**
 * Maps a friend's activity status to how it should be presented: which icon to use, what color to
 * render it in, and its label. Returns `undefined` for the states that shouldn't render anything
 * (online, offline, or not a friend at all).
 */
export function getActivityDescriptor(
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

const statusLineCss = css<{ $color: string }>`
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

const StatusLineRoot = styled.div<{ $color: string }>`
  ${statusLineCss};
`

// The tint is painted outside the line's box (negative margin offset by padding) so that making it
// a button doesn't change the height or alignment of the line it replaces.
const StatusLineButton = styled.button<{ $color: string }>`
  ${buttonReset};
  ${statusLineCss};

  align-self: flex-start;
  max-width: calc(100% + 8px);
  margin: 0 -4px;
  padding: 0 4px;
  border-radius: 4px;
  text-align: left;

  &:hover,
  &:focus-visible {
    background-color: rgb(from ${props => props.$color} r g b / 0.12);
    outline: none;
  }

  &:disabled {
    opacity: var(--theme-disabled-opacity);
    cursor: default;
  }
`

const JoinTooltip = styled(Tooltip)`
  align-self: flex-start;
  min-width: 0;
  max-width: 100%;
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
 *
 * With `joinable`, a friend who's in a lobby the viewer can join gets a line that's a button
 * joining that lobby, whose clicks don't reach the row it's in. `onJoin` runs when it's clicked,
 * for a row to react to the join (e.g. closing a sidebar).
 */
export function FriendActivityStatusLine({
  userId,
  className,
  joinable,
  onJoin,
}: {
  userId: SbUserId
  className?: string
  joinable?: boolean
  onJoin?: () => void
}) {
  if (joinable) {
    return <JoinableStatusLine userId={userId} className={className} onJoin={onJoin} />
  }

  return <PlainStatusLine userId={userId} className={className} />
}

function PlainStatusLine({ userId, className }: { userId: SbUserId; className?: string }) {
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

function JoinableStatusLine({
  userId,
  className,
  onJoin,
}: {
  userId: SbUserId
  className?: string
  onJoin?: () => void
}) {
  const { t } = useTranslation()
  const status = useFriendActivityStatus(userId)
  const joinFriendLobby = useJoinFriendLobby(userId)
  const descriptor = getActivityDescriptor(status, t)

  if (!joinFriendLobby) {
    return <PlainStatusLine userId={userId} className={className} />
  }
  if (!descriptor) {
    return null
  }

  const { lobby, join, isPending } = joinFriendLobby

  return (
    <JoinTooltip
      text={t('users.activityStatus.joinLobby', {
        defaultValue: 'Join lobby: {{lobbyName}}',
        lobbyName: lobby.name,
      })}
      position='left'
      tabIndex={-1}>
      <StatusLineButton
        type='button'
        className={className}
        $color={descriptor.color}
        disabled={isPending}
        onClick={event => {
          // The row this sits in opens the profile overlay when clicked.
          event.stopPropagation()
          onJoin?.()
          join()
        }}>
        <StatusLineIcon icon={descriptor.icon} size={14} />
        <StatusLabel>{descriptor.label}</StatusLabel>
      </StatusLineButton>
    </JoinTooltip>
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
  const lobbyName = useAppSelector(s => s.relationships.friendActivityLobby.get(userId)?.name)
  const descriptor = getActivityDescriptor(status, t)

  if (!descriptor) {
    return null
  }

  const label =
    status === FriendActivityStatus.InLobby && lobbyName !== undefined
      ? t('users.activityStatus.inLobbyNamed', {
          defaultValue: 'In lobby: {{lobbyName}}',
          lobbyName,
        })
      : descriptor.label

  return (
    <GlyphContainer className={className} $color={descriptor.color} role='img' aria-label={label}>
      <Tooltip text={label} position='left' tabIndex={-1}>
        <MaterialIcon icon={descriptor.icon} size={16} />
      </Tooltip>
    </GlyphContainer>
  )
}
