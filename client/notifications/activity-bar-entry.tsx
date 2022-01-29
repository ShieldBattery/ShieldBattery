import keycode from 'keycode'
import React, { useCallback, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'
import NotificationsIcon from '../icons/material/notifications_black_24px.svg'
import { HotkeyProp, IconButton, useButtonHotkey } from '../material/button'
import { Popover, useAnchorPosition } from '../material/popover'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { amberA200 } from '../styles/colors'
import { markLocalNotificationsRead, markNotificationsRead } from './action-creators'
import { ConnectedNotificationsList } from './notifications-list'

const ALT_N: HotkeyProp = { keyCode: keycode('n'), altKey: true }

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
  const idToNotification = useAppSelector(s => s.notifications.byId)
  const notificationIds = useAppSelector(s => s.notifications.orderedIds)
  const [localUnreadNotifications, serverUnreadNotifications] = useMemo(() => {
    const local: string[] = []
    const server: string[] = []
    for (const id of notificationIds) {
      const notification = idToNotification.get(id)
      if (!notification || notification.read) {
        continue
      }

      if (notification.local) {
        local.push(id)
      } else {
        server.push(id)
      }
    }

    return [local, server]
  }, [notificationIds, idToNotification])

  const hasUnread = localUnreadNotifications.length + serverUnreadNotifications.length > 0

  const [anchor, setAnchor] = useState<HTMLElement>()
  const onClick = useCallback((event: React.MouseEvent) => {
    setAnchor(event.currentTarget as HTMLElement)
  }, [])
  const onDismiss = useCallback(() => {
    setAnchor(undefined)
    if (localUnreadNotifications.length) {
      dispatch(markLocalNotificationsRead(localUnreadNotifications))
    }
    if (serverUnreadNotifications.length) {
      dispatch(markNotificationsRead(serverUnreadNotifications))
    }
  }, [localUnreadNotifications, serverUnreadNotifications, dispatch])
  const [, anchorX, anchorY] = useAnchorPosition('right', 'bottom', anchor ?? null)

  const buttonRef = useRef<HTMLButtonElement>()
  useButtonHotkey({ ref: buttonRef, hotkey: ALT_N })

  return (
    <>
      <ButtonContainer>
        <IconButton
          ref={buttonRef}
          icon={<NotificationsIcon />}
          title={hasUnread ? 'Notifications (unread)' : 'Notifications'}
          onClick={onClick}
          testName='notifications-button'
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
