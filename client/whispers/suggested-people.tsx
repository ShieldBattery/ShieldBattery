import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { FriendActivityStatus } from '../../common/users/relationships'
import { SbUserId } from '../../common/users/sb-user-id'
import { ConnectedAvatar } from '../avatars/avatar'
import { GameRelativeTime } from '../games/game-list-entry'
import { MaterialIcon } from '../icons/material/material-icon'
import { MessagePreviewLine } from '../messaging/message-preview-line'
import { CommonTextMessage } from '../messaging/message-records'
import { push } from '../navigation/routing'
import { useAppSelector } from '../redux-hooks'
import { NameBlock, NameLine } from '../social/friend-activity-status'
import { useJoinFriendLobby } from '../social/join-friend-lobby'
import { JoinFriendLobbyIconButton } from '../social/join-friend-lobby-button'
import { bodyLarge, bodyMedium, bodySmall, labelMedium, titleLarge } from '../styles/typography'
import { UserStatusText } from './whisper-header'
import { urlForWhisper } from './whisper-url'

/** The most recent conversations listed under "Recent". */
const MAX_RECENT = 8

const Section = styled.section`
  display: flex;
  flex-direction: column;
  gap: 2px;
`

const SectionHeader = styled.div`
  ${labelMedium};
  height: 28px;
  padding: 0 8px;

  display: flex;
  align-items: center;
  justify-content: space-between;

  color: var(--theme-on-surface-variant);
`

/** The room at a row's end that the join button over it takes: its width, inset and the row's gap. */
const JOIN_BUTTON_RESERVED_END = 52

const RowWrapper = styled.div`
  position: relative;
`

/**
 * The join button sits beside the row rather than inside it: the row is itself a `role='link'`,
 * which can't contain another control.
 */
const RowJoinButton = styled(JoinFriendLobbyIconButton)`
  position: absolute;
  top: 50%;
  right: 8px;
  transform: translateY(-50%);
`

const Row = styled.div<{ $reserveEnd?: boolean }>`
  min-height: 52px;
  padding: 6px 8px;
  ${props => (props.$reserveEnd ? `padding-right: ${JOIN_BUTTON_RESERVED_END}px;` : '')}

  display: flex;
  align-items: center;
  gap: 12px;

  border-radius: 6px;
  cursor: pointer;

  &:hover {
    background-color: rgb(from var(--theme-on-surface) r g b / 0.06);
  }

  &:focus-visible {
    outline: 2px solid var(--theme-grey-blue);
    outline-offset: -2px;
  }
`

const RowAvatar = styled(ConnectedAvatar)`
  width: 36px;
  height: 36px;
  flex-shrink: 0;
`

const RowName = styled(NameLine)`
  ${bodyMedium};
`

const StatusText = styled(UserStatusText)`
  ${bodySmall};
`

const RowTime = styled(GameRelativeTime)`
  ${bodySmall};
  flex-shrink: 0;
  color: var(--theme-on-surface-variant);
`

const EmptyState = styled.div`
  ${bodyLarge};
  min-height: 320px;
  padding: 32px;

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;

  color: var(--theme-on-surface-variant);
  text-align: center;
`

const EmptyStateTitle = styled.div`
  ${titleLarge};
  color: var(--theme-on-surface);
`

function PersonRow({
  userId,
  secondary,
  trailing,
  showJoin = false,
}: {
  userId: SbUserId
  secondary: React.ReactNode
  trailing?: React.ReactNode
  /** Offers joining the person's lobby, when they're in one, at the end of the row. */
  showJoin?: boolean
}) {
  const joinFriendLobby = useJoinFriendLobby(userId)
  const username = useAppSelector(s => s.users.byId.get(userId)?.name)
  const url = urlForWhisper(userId, username ?? '')

  return (
    <RowWrapper>
      <Row
        $reserveEnd={showJoin && !!joinFriendLobby}
        role='link'
        tabIndex={0}
        aria-label={username}
        onClick={() => push(url)}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault()
            push(url)
          }
        }}>
        <RowAvatar userId={userId} showAvailability={true} />
        <NameBlock>
          <RowName>{username}</RowName>
          {secondary}
        </NameBlock>
        {trailing}
      </Row>
      {showJoin ? <RowJoinButton userId={userId} /> : null}
    </RowWrapper>
  )
}

/**
 * The people most worth starting a whisper with before anything's been typed: friends who are
 * online now, and the most recent conversations.
 */
export function SuggestedPeople() {
  const { t } = useTranslation()
  const selfId = useAppSelector(s => s.auth.self?.user.id)
  const blocks = useAppSelector(s => s.relationships.blocks)
  const friends = useAppSelector(s => s.relationships.friends)
  const friendActivityStatus = useAppSelector(s => s.relationships.friendActivityStatus)
  const usersById = useAppSelector(s => s.users.byId)
  const lastMessages = useAppSelector(s => s.whispers.lastMessages)
  const conversationsLoaded = useAppSelector(s => s.whispers.conversationsLoaded)

  const onlineFriends = Array.from(friends.keys())
    .filter(
      id =>
        !blocks.has(id) &&
        (friendActivityStatus.get(id) ?? FriendActivityStatus.Offline) !==
          FriendActivityStatus.Offline,
    )
    .sort((a, b) => (usersById.get(a)?.name ?? '').localeCompare(usersById.get(b)?.name ?? ''))

  const recent: Array<[SbUserId, CommonTextMessage]> = Array.from(lastMessages)
    .filter(([id]) => id !== selfId && !blocks.has(id))
    .sort(([, a], [, b]) => b.time - a.time)
    .slice(0, MAX_RECENT)

  if (onlineFriends.length === 0 && recent.length === 0) {
    // Until the conversation list has loaded, an empty list says nothing about whether there are
    // conversations.
    return conversationsLoaded ? (
      <EmptyState>
        <MaterialIcon icon='forum' size={40} />
        <EmptyStateTitle>
          {t('whispers.newWhisper.emptyTitle', 'Start a conversation')}
        </EmptyStateTitle>
        <div>
          {t(
            'whispers.newWhisper.emptyText',
            "Type a player's name above to whisper them. Friends show up here while they're online.",
          )}
        </div>
      </EmptyState>
    ) : null
  }

  return (
    <>
      {onlineFriends.length > 0 ? (
        <Section>
          <SectionHeader>
            <span>{t('whispers.newWhisper.onlineFriends', 'Online friends')}</span>
            <span>{onlineFriends.length}</span>
          </SectionHeader>
          {onlineFriends.map(id => (
            <PersonRow
              key={id}
              userId={id}
              secondary={<StatusText userId={id} />}
              showJoin={true}
            />
          ))}
        </Section>
      ) : null}

      {recent.length > 0 ? (
        <Section>
          <SectionHeader>
            <span>{t('whispers.newWhisper.recent', 'Recent')}</span>
          </SectionHeader>
          {recent.map(([id, message]) => (
            <PersonRow
              key={id}
              userId={id}
              secondary={<MessagePreviewLine message={message} />}
              trailing={<RowTime timestampMs={message.time} />}
            />
          ))}
        </Section>
      ) : null}
    </>
  )
}
