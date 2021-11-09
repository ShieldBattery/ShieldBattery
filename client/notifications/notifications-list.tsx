import { Immutable } from 'immer'
import React, { useCallback, useMemo } from 'react'
import styled from 'styled-components'
import { SbNotification } from '../../common/notifications'
import { TextButton } from '../material/button'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { colorTextFaint, colorTextSecondary } from '../styles/colors'
import { headline6, subtitle1 } from '../styles/typography'
import { clearNotifications } from './action-creators'
import { notificationToUi } from './notification-to-ui'

const ListContainer = styled.div`
  width: 100%;
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

const ClearButton = styled(TextButton)`
  min-width: 84px;
  margin-right: 4px;
`

export interface NotificationsListProps {
  notifications: Immutable<SbNotification[]>
  onClear: () => void
}

export function NotificationsList(props: NotificationsListProps) {
  return (
    <ListContainer>
      <TitleArea>
        <TitleText>Notifications</TitleText>
        <ClearButton label='Clear' color='accent' onClick={props.onClear} />
      </TitleArea>
      <ListArea>
        {props.notifications.length > 0 ? (
          props.notifications.map((n, i) =>
            notificationToUi(n, `notif-${i}`, i < props.notifications.length - 1),
          )
        ) : (
          <EmptyList>Nothing to see here</EmptyList>
        )}
      </ListArea>
    </ListContainer>
  )
}

export function ConnectedNotificationsList() {
  const idToNotification = useAppSelector(s => s.notifications.byId)
  const notificationIds = useAppSelector(s => s.notifications.orderedIds)
  const dispatch = useAppDispatch()
  const onClear = useCallback(() => dispatch(clearNotifications()), [dispatch])
  const orderedNotifications = useMemo(
    () => notificationIds.map(id => idToNotification.get(id)!),
    [notificationIds, idToNotification],
  )

  return <NotificationsList notifications={orderedNotifications} onClear={onClear} />
}
