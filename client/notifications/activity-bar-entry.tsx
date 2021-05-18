import React, { useCallback, useMemo, useState } from 'react'
import styled from 'styled-components'
import NotificationsIcon from '../icons/material/notifications_black_24px.svg'
import { IconButton } from '../material/button'
import { Popover, useAnchorPosition } from '../material/popover'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { amberA200 } from '../styles/colors'
import { markLocalNotificationsRead, markNotificationsRead } from './action-creators'
import { NotificationRecordBase } from './notification-reducer'
import { ConnectedNotificationsList } from './notifications-list'

const UnreadIndicator = styled.div`
  width: 8px;
  height: 8px;
  position: absolute;
  left: 8px;
  top: 12px;

  background-color: ${amberA200};
  border-radius: 50%;
  pointer-events: none;
`

const ButtonContainer = styled.div`
  width: 48px;
  height: 48px;
  position: relative;

  contain: content;
`

const PopoverScrollable = styled.div`
  max-height: calc(var(--sb-popover-max-height) * 0.667);
  overflow-y: auto;
`

const PopoverContents = styled.div`
  width: 320px;
`

export function NotificationsButton() {
  const dispatch = useAppDispatch()
  const idToNotification = useAppSelector(s => s.notifications.idToNotification)
  const notificationIds = useAppSelector(s => s.notifications.reversedNotificationIds)
  const [localUnreadNotifications, serverUnreadNotifications] = useMemo(() => {
    const group = notificationIds
      .filter(id => !idToNotification.get(id)?.read)
      .groupBy(id => (idToNotification.get(id)! as NotificationRecordBase).local)
    return [group.get(true), group.get(false)]
  }, [notificationIds, idToNotification])
  const hasUnread = useMemo(() => idToNotification.some(n => !n.read), [idToNotification])

  const [anchor, setAnchor] = useState<HTMLElement>()
  const onClick = useCallback((event: React.MouseEvent) => {
    setAnchor(event.currentTarget as HTMLElement)
  }, [])
  const onDismiss = useCallback(() => {
    setAnchor(undefined)
    if (localUnreadNotifications?.count()) {
      dispatch(markLocalNotificationsRead(localUnreadNotifications.valueSeq().toArray()))
    }
    if (serverUnreadNotifications?.count()) {
      dispatch(markNotificationsRead(serverUnreadNotifications.valueSeq().toArray()))
    }
  }, [localUnreadNotifications, serverUnreadNotifications, dispatch])
  const [, anchorX, anchorY] = useAnchorPosition('right', 'bottom', anchor ?? null)

  return (
    <>
      <ButtonContainer>
        <IconButton
          icon={<NotificationsIcon />}
          title={hasUnread ? 'Notifications (unread)' : 'Notifications'}
          onClick={onClick}
        />
        {hasUnread ? <UnreadIndicator /> : null}
      </ButtonContainer>
      <Popover
        open={!!anchor}
        onDismiss={onDismiss}
        anchorX={(anchorX ?? 0) - 8}
        anchorY={(anchorY ?? 0) - 8}
        originX='right'
        originY='bottom'>
        <PopoverScrollable>
          <PopoverContents>
            <ConnectedNotificationsList />
          </PopoverContents>
        </PopoverScrollable>
      </Popover>
    </>
  )
}
