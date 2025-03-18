import { AnimatePresence, Transition, Variants } from 'motion/react'
import * as m from 'motion/react-m'
import React, { useCallback, useEffect, useRef } from 'react'
import ReactDOM from 'react-dom'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useExternalElementRef } from '../dom/use-external-element-ref'
import { MaterialIcon } from '../icons/material/material-icon'
import { IconButton } from '../material/button'
import { elevationPlus3 } from '../material/shadows'
import { zIndexMenu } from '../material/zindex'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { ContainerLevel, containerStyles } from '../styles/colors'
import {
  markLocalNotificationsRead,
  markNotificationShown,
  markNotificationsRead,
} from './action-creators'
import { notificationToUi } from './notification-to-ui'

const POPOVER_DURATION = 10000

const PopupsContainer = styled.div`
  position: fixed;
  right: 0;
  bottom: 0;
  width: calc(368px + 64px);
  height: calc(100% - 96px);
  padding: 32px;
  z-index: ${zIndexMenu};

  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: flex-end;

  overflow: hidden;
  pointer-events: none;
`

const Popup = styled(m.div)`
  ${elevationPlus3};
  ${containerStyles(ContainerLevel.High)};

  contain: content;

  display: flex;
  flex-direction: row;
  align-items: flex-start;

  border-radius: 8px;
  pointer-events: auto;

  &:not(:first-child) {
    margin-top: 16px;
  }
`

const MarkAsReadButton = styled(IconButton)`
  flex-shrink: 0;
  align-self: stretch;
  border-radius: 0;
  background-color: var(--theme-grey-blue-container);
  color: var(--theme-on-grey-blue-container);
`

const popupVariants: Variants = {
  initial: { opacity: 0, y: 40 },
  visible: { opacity: 1, y: 0 },
  exit: { opacity: 0, x: 400 },
}

const popupTransition: Transition = {
  default: {
    type: 'spring',
    duration: 0.5,
  },
  opacity: {
    type: 'spring',
    duration: 0.3,
    bounce: 0,
  },
}

interface NotificationPopupProps {
  notificationId: string
  onDismiss: (notificationId: string) => void
}

const NotificationPopup = React.forwardRef<HTMLDivElement, NotificationPopupProps>(
  ({ notificationId, onDismiss }, ref) => {
    const { t } = useTranslation()
    const dispatch = useAppDispatch()
    const notification = useAppSelector(s => s.notifications.byId.get(notificationId))
    const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined)

    // Schedule auto-dismissal when the animation completes
    const scheduleRemoval = useCallback(() => {
      timeoutRef.current = setTimeout(() => {
        onDismiss(notificationId)
      }, POPOVER_DURATION)
    }, [notificationId, onDismiss])

    // Clear timeout on unmount
    useEffect(() => {
      return () => {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
        }
      }
    }, [])

    const onMarkAsRead = useCallback(() => {
      if (!notification) {
        return
      }

      if (notification.local) {
        dispatch(markLocalNotificationsRead([notification.id]))
      } else {
        dispatch(markNotificationsRead([notification.id]))
      }

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }

      onDismiss(notification.id)
    }, [dispatch, notification, onDismiss])

    return (
      <Popup
        ref={ref}
        layout={true}
        variants={popupVariants}
        initial='initial'
        animate='visible'
        exit='exit'
        transition={popupTransition}
        onAnimationComplete={scheduleRemoval}>
        {notification
          ? notificationToUi(notification, notification.id, false /* showDivider */, null)
          : null}
        <MarkAsReadButton
          icon={<MaterialIcon icon='check' />}
          title={t('notifications.popup.markAsRead', 'Mark as read')}
          onClick={onMarkAsRead}
        />
      </Popup>
    )
  },
)

export default function NotificationPopups() {
  const dispatch = useAppDispatch()
  const idToNotification = useAppSelector(s => s.notifications.byId)
  const orderedIds = useAppSelector(s => s.notifications.orderedIds)
  const shownIds = useAppSelector(s => s.notifications.shownIds)

  const unshown = orderedIds.filter(id => {
    const notification = idToNotification.get(id)
    return notification && !notification.read && !shownIds.has(id)
  })
  const portalRef = useExternalElementRef()

  return ReactDOM.createPortal(
    <PopupsContainer>
      <AnimatePresence mode='popLayout'>
        {unshown.map(id => (
          <NotificationPopup
            key={id}
            notificationId={id}
            onDismiss={id => dispatch(markNotificationShown(id))}
          />
        ))}
      </AnimatePresence>
    </PopupsContainer>,
    portalRef.current,
  )
}
