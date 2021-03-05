import { List } from 'immutable'
import React, { useCallback } from 'react'
import styled from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import { NotificationType } from '../../common/notifications'
import { EmailVerificationNotificationUi } from '../auth/email-verification-notification-ui'
import FlatButton from '../material/flat-button'
import { PartyInviteNotificationUi } from '../parties/party-notification-ui'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { colorTextFaint, colorTextSecondary } from '../styles/colors'
import { headline6, subtitle1 } from '../styles/typography'
import { clearNotifications } from './action-creators'
import { NotificationRecord } from './notification-reducer'

const ListContainer = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
`

const TitleArea = styled.div`
  width: 100%;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;

  padding-left: 16px; // no right padding because the button has built-in padding
`

const TitleText = styled.div`
  ${headline6};
  color: ${colorTextSecondary};
`

const ListArea = styled.div`
  flex-grow: 1;
  overflow-y: auto;
`

const EmptyList = styled.div`
  ${subtitle1};
  padding: 32px 16px 48px;

  color: ${colorTextFaint};
  text-align: center;
`

export interface NotificationsListProps {
  notifications: List<NotificationRecord>
  onClear: () => void
}

export function NotificationsList(props: NotificationsListProps) {
  return (
    <ListContainer>
      <TitleArea>
        <TitleText>Notifications</TitleText>
        <FlatButton label='Clear' color='accent' onClick={props.onClear} />
      </TitleArea>
      <ListArea>
        {props.notifications.size > 0 ? (
          props.notifications.map((n, i) => toUi(n, `notif-${i}`, i < props.notifications.size - 1))
        ) : (
          <EmptyList>Nothing to see here</EmptyList>
        )}
      </ListArea>
    </ListContainer>
  )
}

export function ConnectedNotificationsList() {
  const map = useAppSelector(s => s.notifications.map)
  const ids = useAppSelector(s => s.notifications.ids)
  const dispatch = useAppDispatch()
  const onClear = useCallback(() => dispatch(clearNotifications()), [dispatch])

  return (
    <NotificationsList notifications={ids.map(id => map.get(id)!).toList()} onClear={onClear} />
  )
}

function toUi(notification: NotificationRecord, key: string, showDivider: boolean) {
  switch (notification.type) {
    case NotificationType.EmailVerification:
      return (
        <EmailVerificationNotificationUi
          key={key}
          showDivider={showDivider}
          unread={!notification.read}
        />
      )
    case NotificationType.PartyInvite:
      return (
        <PartyInviteNotificationUi
          key={key}
          from={notification.from}
          partyId={notification.partyId}
          notificationId={notification.id}
          showDivider={showDivider}
          unread={!notification.read}
        />
      )
    default:
      return assertUnreachable(notification)
  }
}
