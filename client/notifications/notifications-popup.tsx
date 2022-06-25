import { Immutable } from 'immer'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactDOM from 'react-dom'
import {
  animated,
  AnimationResult,
  Controller,
  useTransition,
  UseTransitionProps,
} from 'react-spring'
import styled from 'styled-components'
import { subtract, union } from '../../common/data-structures/sets'
import { SbNotification } from '../../common/notifications'
import { useExternalElementRef } from '../dom/use-external-element-ref'
import CheckIcon from '../icons/material/check-24px.svg'
import { IconButton } from '../material/button'
import { shadow6dp } from '../material/shadows'
import { defaultSpring } from '../material/springs'
import { zIndexMenu } from '../material/zindex'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { usePrevious } from '../state-hooks'
import { background300, background400 } from '../styles/colors'
import { markLocalNotificationsRead, markNotificationsRead } from './action-creators'
import { notificationToUi } from './notification-to-ui'

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
  background-color: ${background400};
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
  background-color: ${background300};
`

export default function NotificationPopups() {
  const dispatch = useAppDispatch()
  const idToNotification = useAppSelector(s => s.notifications.byId)
  const notificationIds = useAppSelector(s => s.notifications.orderedIds)
  const unreadIds = useRef(new Set<string>())
  const prevIds = usePrevious(unreadIds.current)
  const [newIds, removedIds] = useMemo(() => {
    const filtered = new Set(notificationIds.filter(id => !idToNotification.get(id)?.read))
    if (
      filtered.size !== unreadIds.current.size ||
      union(filtered, unreadIds.current).size > filtered.size
    ) {
      unreadIds.current = filtered
      const newIds = subtract(unreadIds.current, prevIds ?? [])
      const removedIds = subtract(prevIds ?? new Set<string>(), unreadIds.current)

      return [newIds, removedIds]
    } else {
      // unread IDs didn't change
      return [new Set<string>(), new Set<string>()]
    }
  }, [notificationIds, prevIds, idToNotification])

  const popupElems = useRef(new Map<string, HTMLDivElement>())
  const cancelFuncs = useRef(new Map<string, () => Controller>())
  const portalRef = useExternalElementRef()
  const [notificationItems, setNotificationItems] = useState<Immutable<SbNotification[]>>([])

  useEffect(() => {
    setNotificationItems(items =>
      Array.from(newIds, id => idToNotification.get(id)!).concat(
        // NOTE(tec27): There seems to be some way that things can interleave such that newItems
        // get added to items but then the next `newItems` still contains the ID. We don't expect
        // there to be *that* many popups so doing this precautionary filter to avoid duplicate
        // notifications seems fine
        items.filter(item => !newIds.has(item.id)),
      ),
    )
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

  const popupTransition = useTransition<SbNotification, UseTransitionProps<SbNotification>>(
    notificationItems,
    {
      from: { opacity: 0, height: 0, duration: '100%' },
      enter: item => async (next, cancel) => {
        cancelFuncs.current.set(item.id, cancel)
        await next({ opacity: 1, height: popupElems.current?.get(item.id)?.offsetHeight })
        await next({ duration: '0%' })
      },
      leave: { opacity: 0, height: 0 },
      onRest: (result: AnimationResult, ctrl: Controller, item: SbNotification) => {
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
    (notification: SbNotification) => {
      if (notification.local) {
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
          {notificationToUi(
            item,
            item.id /* key */,
            false /* showDivider */,
            (elem: HTMLDivElement | null) => {
              if (elem) {
                popupElems.current.set(item.id, elem)
              } else {
                popupElems.current.delete(item.id)
              }
            },
          )}
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
