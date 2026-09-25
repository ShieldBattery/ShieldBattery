import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { SbUserId } from '../../common/users/sb-user-id'
import { ConnectedAvatar } from '../avatars/avatar'
import { MaterialIcon } from '../icons/material/material-icon'
import {
  BackdropCard,
  BackdropCardAction,
  BackdropCardHeader,
  BackdropCardMeta,
  BackdropCardMetaText,
  BackdropCardTitle,
  backdropTextShadow,
  getBackdropCardHeight,
} from '../messaging/backdrop-card'
import { bodySmall, labelMedium, singleLine, titleSmall } from '../styles/typography'
import { ConnectedUsername } from '../users/connected-username'
import { getActivityDescriptor, useFriendActivityStatus } from './friend-activity-status'

/**
 * Every row is one line tall whatever it holds, so the card's height is exactly its row count times
 * a row's height and nothing in a row (an overlong name, say) can push the rest of the card around.
 */
const ROW_HEIGHT = 28

const Row = styled.div<{ $offline: boolean }>`
  height: ${ROW_HEIGHT}px;
  min-width: 0;

  display: flex;
  align-items: center;
  gap: 8px;

  opacity: ${props => (props.$offline ? 'var(--theme-disabled-opacity)' : '1')};
`

const RowAvatar = styled(ConnectedAvatar)`
  width: 20px;
  height: 20px;
  flex-shrink: 0;
`

/**
 * Holds a name that ellipsizes: the username renders inside a tooltip's wrapper, which is what
 * actually sits in the row, so the wrapper needs the room limits instead of the name.
 */
const NameSlot = styled.div`
  min-width: 0;
  flex-grow: 1;
  display: flex;

  & > * {
    min-width: 0;
    max-width: 100%;
  }
`

const RowName = styled(ConnectedUsername)`
  ${titleSmall};
  ${singleLine};
  ${backdropTextShadow};
  min-width: 0;
  color: var(--theme-on-surface);
`

const RowActivity = styled.span<{ $color: string }>`
  ${labelMedium};
  ${backdropTextShadow};
  flex-shrink: 0;

  display: flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;

  color: ${props => props.$color};
`

function FriendRow({ userId, offline }: { userId: SbUserId; offline: boolean }) {
  const { t } = useTranslation()
  const status = useFriendActivityStatus(userId)
  // An offline friend never has an activity to report, but the row still gates on `offline`
  // directly rather than leaning on that to stay true.
  const activity = offline ? undefined : getActivityDescriptor(status, t)

  return (
    <Row $offline={offline}>
      <RowAvatar userId={userId} />
      <NameSlot>
        <RowName userId={userId} showTooltipForOverflow='top' />
      </NameSlot>
      {activity ? (
        <RowActivity $color={activity.color}>
          <MaterialIcon icon={activity.icon} size={16} />
          {activity.label}
        </RowActivity>
      ) : null}
    </Row>
  )
}

const Rows = styled.div`
  display: flex;
  flex-direction: column;
`

const NoneOnlineLine = styled.div`
  ${bodySmall};
  ${backdropTextShadow};
  height: ${ROW_HEIGHT}px;
  display: flex;
  align-items: center;
  color: var(--theme-on-surface-variant);
`

/**
 * The friends a `/f list` answered with, split into who was online and who wasn't at that moment.
 * That split is fixed when the answer is given, so a friend crossing between online and offline
 * doesn't move them between the two groups; what each friend is doing stays live.
 *
 * The card's header counts both groups; the offline friends start hidden behind a quiet header
 * action, which appends them (dimmed) after the online ones.
 */
export function FriendListCard({
  onlineIds,
  offlineIds,
}: {
  onlineIds: ReadonlyArray<SbUserId>
  offlineIds: ReadonlyArray<SbUserId>
}) {
  const { t } = useTranslation()
  const [offlineShown, setOfflineShown] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const wasOfflineShown = useRef(offlineShown)

  useLayoutEffect(() => {
    // The card usually sits at the bottom of the chat, so rows the header action adds land below
    // the fold; nothing else re-scrolls the view for content that grows after it's been read.
    if (offlineShown && !wasOfflineShown.current) {
      rootRef.current?.scrollIntoView({ block: 'nearest' })
    }
    wasOfflineShown.current = offlineShown
  }, [offlineShown])

  const shown: Array<{ id: SbUserId; offline: boolean }> = [
    ...onlineIds.map(id => ({ id, offline: false })),
    ...(offlineShown ? offlineIds.map(id => ({ id, offline: true })) : []),
  ]

  const showLabel = t('chat.commands.friends.list.showOffline', 'Show offline')
  const hideLabel = t('chat.commands.friends.list.hideOffline', 'Hide offline')

  return (
    <div ref={rootRef}>
      <BackdropCard
        imageUrl={undefined}
        height={getBackdropCardHeight(Math.max(1, shown.length) * ROW_HEIGHT)}>
        <BackdropCardHeader>
          <BackdropCardTitle text={t('chat.commands.friends.list.title', 'Friends')} />
          <BackdropCardMeta>
            <BackdropCardMetaText
              text={t('chat.commands.friends.list.counts', {
                defaultValue: '{{online}} online · {{total}} friends',
                online: onlineIds.length,
                total: onlineIds.length + offlineIds.length,
              })}
            />
          </BackdropCardMeta>
          {offlineIds.length ? (
            <BackdropCardAction
              ariaLabel={offlineShown ? hideLabel : showLabel}
              ariaExpanded={offlineShown}
              onClick={() => setOfflineShown(!offlineShown)}>
              <MaterialIcon icon={offlineShown ? 'expand_less' : 'expand_more'} size={18} />
              {offlineShown ? hideLabel : showLabel}
            </BackdropCardAction>
          ) : null}
        </BackdropCardHeader>
        {shown.length ? (
          <Rows>
            {shown.map(({ id, offline }) => (
              <FriendRow key={id} userId={id} offline={offline} />
            ))}
          </Rows>
        ) : (
          <NoneOnlineLine>
            {t('chat.commands.friends.list.noneOnline', 'No friends online')}
          </NoneOnlineLine>
        )}
      </BackdropCard>
    </div>
  )
}
