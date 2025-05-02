import keycode from 'keycode'
import React, { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { HotkeyProp, IconButton, useButtonHotkey } from '../material/button'
import { Popover, useElemAnchorPosition, usePopoverController } from '../material/popover'
import { Tooltip } from '../material/tooltip'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { markLocalNotificationsRead, markNotificationsRead } from './action-creators'
import { ConnectedNotificationsList } from './notifications-list'

const ALT_N: HotkeyProp = { keyCode: keycode('n'), altKey: true }

const UnreadIndicator = styled.div`
  width: 8px;
  height: 8px;
  position: absolute;
  left: 8px;
  top: 12px;

  background-color: var(--color-amber80);
  border-radius: 50%;
  pointer-events: none;
`

const ButtonContainer = styled.div`
  width: 48px;
  height: 48px;
  position: relative;

  display: flex;
  align-items: center;
  justify-content: flex-end;

  contain: layout;
`

const PopoverScrollable = styled.div`
  max-height: calc(var(--sb-popover-max-height) * 0.667);
  overflow-y: auto;
`

const PopoverContents = styled.div`
  width: 320px;
`

export function NotificationsButton({ icon }: { icon: React.ReactNode }) {
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

  const [buttonElem, setButtonElem] = useState<HTMLButtonElement | null>(null)
  useButtonHotkey({ elem: buttonElem, hotkey: ALT_N })

  const [anchorX, anchorY] = useElemAnchorPosition(buttonElem, 'center', 'bottom')

  return (
    <>
      <ButtonContainer>
        <Tooltip
          text={
            hasUnread
              ? t('notifications.activityButton.unread', 'Notifications - unread (Alt + N)')
              : t('notifications.activityButton.read', 'Notifications (Alt + N)')
          }
          position='bottom'
          tabIndex={-1}>
          <IconButton
            ref={setButtonElem}
            icon={icon}
            onClick={openActivityBar}
            testName='notifications-button'
          />
        </Tooltip>
        {hasUnread ? <UnreadIndicator /> : null}
      </ButtonContainer>
      <Popover
        open={activityBarOpen}
        onDismiss={onDismiss}
        anchorX={anchorX ?? 0}
        anchorY={(anchorY ?? 0) - 8}
        originX='center'
        originY='top'>
        <PopoverScrollable>
          <PopoverContents>
            <ConnectedNotificationsList />
          </PopoverContents>
        </PopoverScrollable>
      </Popover>
    </>
  )
}
