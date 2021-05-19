import { OrderedSet } from 'immutable'
import { lighten } from 'polished'
import React, { useCallback, useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import {
  animated,
  AnimationResult,
  Controller,
  useTransition,
  UseTransitionProps,
} from 'react-spring'
import styled from 'styled-components'
import { assertUnreachable } from '../../common/assert-unreachable'
import { NotificationType } from '../../common/notifications'
import { EmailVerificationNotificationUi } from '../auth/email-verification-notification-ui'
import { useExternalElementRef } from '../dom/use-external-element-ref'
import CheckIcon from '../icons/material/check-24px.svg'
import IconButton from '../material/icon-button'
import { shadow6dp } from '../material/shadows'
import { defaultSpring } from '../material/springs'
import { zIndexMenu } from '../material/zindex'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { usePrevious } from '../state-hooks'
import { blue900, grey800 } from '../styles/colors'
import { markLocalNotificationsRead, markNotificationsRead } from './action-creators'
import { NotificationRecord, NotificationRecordBase } from './notification-reducer'

const POPOVER_DURATION = 10000

const PopupsContainer = styled.div`
  position: fixed;
  right: 32px;
  bottom: 32px;
  width: 368px;
  max-height: calc(100% - 112px);
  z-index: ${zIndexMenu};

  display: flex;
  flex-direction: column;
  align-items: flex-end;

  overflow-y: auto;
  &::-webkit-scrollbar {
    width: 0px;
  }
`

const Popup = styled(animated.div)`
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  background-color: ${grey800};
  ${shadow6dp};
  border-radius: 2px;

  &:not(:first-child) {
    margin-top: 16px;
  }
`

const MarkAsReadButton = styled(IconButton)`
  flex-shrink: 0;
  height: 100%;
  border-radius: 0;
  background-color: ${blue900};

  &:hover {
    background-color: ${lighten(0.08, blue900)};
  }
  &:active {
    background-color: ${lighten(0.12, blue900)};
  }
`

export default function NotificationPopups() {
  const dispatch = useAppDispatch()
  const idToNotification = useAppSelector(s => s.notifications.idToNotification)
  const notificationIds = useAppSelector(s => s.notifications.reversedNotificationIds)
  const unreadIds = notificationIds.filter(id => !idToNotification.get(id)?.read)
  const prevIds = usePrevious(unreadIds) ?? OrderedSet()
  const newIds = unreadIds.subtract(prevIds)
  const removedIds = prevIds.subtract(unreadIds)

  const popupElems = useRef(new Map<string, HTMLDivElement>())
  const cancelFuncs = useRef(new Map<string, () => Controller>())
  const portalRef = useExternalElementRef()
  const [notificationItems, setNotificationItems] = useState<NotificationRecord[]>([])

  useEffect(() => {
    setNotificationItems(items => [...newIds.map(id => idToNotification.get(id)!), ...items])
  }, [idToNotification, newIds])

  useEffect(() => {
    for (const id of removedIds) {
      const cancelFunc = cancelFuncs.current.get(id)
      if (cancelFunc) {
        cancelFunc()
        cancelFuncs.current.delete(id)
      }
    }
  }, [removedIds, cancelFuncs])

  const popupTransition = useTransition<NotificationRecord, UseTransitionProps<NotificationRecord>>(
    notificationItems,
    {
      from: { opacity: 0, height: 0, duration: '100%' },
      enter: item => async (next, cancel) => {
        cancelFuncs.current.set(item.id, cancel)
        await next({ opacity: 1, height: popupElems.current?.get(item.id)?.offsetHeight })
        await next({ duration: '0%' })
      },
      leave: { opacity: 0, height: 0 },
      onRest: (result: AnimationResult, ctrl: Controller, item: NotificationRecord) => {
        setNotificationItems(state => state.filter(i => i.id !== item.id))
      },
      // Force the react-spring to remove the notification element from the DOM as soon as its
      // 'leave' animation has finished, so the popup's container scroll height can be recalculated
      // and work as expected.
      expires: 1,
      config: (item, index, phase) => key => {
        return {
          ...defaultSpring,
          clamp: true,
          duration: phase === 'enter' && key === 'duration' ? POPOVER_DURATION : undefined,
        }
      },
    },
  )

  const onMarkAsRead = useCallback(
    (notification: NotificationRecord) => {
      if ((notification as NotificationRecordBase).local) {
        dispatch(markLocalNotificationsRead([notification.id]))
      } else {
        dispatch(markNotificationsRead([notification.id]))
      }
    },
    [dispatch],
  )

  return ReactDOM.createPortal(
    <PopupsContainer>
      {popupTransition((styles, item) => (
        <Popup style={styles}>
          {toUi(item, popupElems.current)}
          <MarkAsReadButton
            icon={<CheckIcon />}
            title='Mark as read'
            onClick={() => onMarkAsRead(item)}
          />
        </Popup>
      ))}
    </PopupsContainer>,
    portalRef.current,
  )
}

function toUi(notification: NotificationRecord, popupElems: Map<string, HTMLDivElement>) {
  switch (notification.type) {
    case NotificationType.EmailVerification:
      return (
        <EmailVerificationNotificationUi
          ref={elem => elem && popupElems.set(notification.id, elem)}
          key={notification.id}
          showDivider={false}
          read={notification.read}
        />
      )
    case NotificationType.PartyInvite:
      return <span />
    default:
      return assertUnreachable(notification)
  }
}
