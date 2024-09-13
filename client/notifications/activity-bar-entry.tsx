import keycode from 'keycode'
import React, { useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { styled } from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon.js'
import { HotkeyProp, IconButton, useButtonHotkey } from '../material/button.js'
import { Popover, useAnchorPosition, usePopoverController } from '../material/popover.js'
import { Tooltip } from '../material/tooltip.js'
import { useAppDispatch, useAppSelector } from '../redux-hooks.js'
import { amberA200 } from '../styles/colors.js'
import { markLocalNotificationsRead, markNotificationsRead } from './action-creators.js'
import { ConnectedNotificationsList } from './notifications-list.js'

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
  const { t } = useTranslation()
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

  const [activityBarOpen, openActivityBar, closeActivityBar] = usePopoverController()
  const onDismiss = useCallback(() => {
    closeActivityBar()
    if (localUnreadNotifications.length) {
      dispatch(markLocalNotificationsRead(localUnreadNotifications))
    }
    if (serverUnreadNotifications.length) {
      dispatch(markNotificationsRead(serverUnreadNotifications))
    }
  }, [closeActivityBar, localUnreadNotifications, serverUnreadNotifications, dispatch])

  const buttonRef = useRef<HTMLButtonElement>(null)
  useButtonHotkey({ ref: buttonRef, hotkey: ALT_N })

  const [, anchorX, anchorY] = useAnchorPosition('right', 'bottom', buttonRef.current)

  return (
    <>
      <ButtonContainer>
        <Tooltip
          text={
            hasUnread
              ? t('notifications.activityButton.unread', 'Notifications - unread (Alt + N)')
              : t('notifications.activityButton.read', 'Notifications (Alt + N)')
          }
          position='left'>
          <IconButton
            ref={buttonRef}
            icon={<MaterialIcon icon='notifications' />}
            onClick={openActivityBar}
            testName='notifications-button'
          />
        </Tooltip>
        {hasUnread ? <UnreadIndicator /> : null}
      </ButtonContainer>
      <Popover
        open={activityBarOpen}
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
