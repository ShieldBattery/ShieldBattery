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

const Row = styled.div`
  min-height: 52px;
  padding: 6px 8px;

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
}: {
  userId: SbUserId
  secondary: React.ReactNode
  trailing?: React.ReactNode
}) {
  const username = useAppSelector(s => s.users.byId.get(userId)?.name)
  const url = urlForWhisper(userId, username ?? '')

  return (
    <Row
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
            <PersonRow key={id} userId={id} secondary={<StatusText userId={id} />} />
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
