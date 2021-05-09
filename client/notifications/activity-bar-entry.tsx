import React, { useCallback, useMemo, useRef, useState } from 'react'
import { CSSTransition } from 'react-transition-group'
import styled from 'styled-components'
import NotificationsIcon from '../icons/material/notifications_black_24px.svg'
import { fastOutSlowIn } from '../material/curve-constants'
import IconButton from '../material/icon-button'
import { LegacyPopover } from '../material/legacy-popover'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { amberA200, colorTextSecondary } from '../styles/colors'
import { markLocalNotificationsRead, markNotificationsRead } from './action-creators'
import { ConnectedNotificationsList } from './notifications-list'

const FadedNotificationsIcon = styled(NotificationsIcon)`
  color: ${colorTextSecondary};
`

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

const transitionNames = {
  appear: 'enter',
  appearActive: 'enterActive',
  enter: 'enter',
  enterActive: 'enterActive',
  exit: 'exit',
  exitActive: 'exitActive',
}

interface PopoverContentsProps {
  transitionDuration: number
  transitionDelay: number
}

const StyledLegacyPopover = styled(LegacyPopover)`
  max-height: calc(100% - 128px);
`

const PopoverContents = styled.div<PopoverContentsProps>`
  width: 320px;
  height: 100%;
  position: relative;
  display: flex;
  flex-direction: column;

  &.enter {
    opacity: 0;
    transform: translateY(-16px);
  }

  &.enterActive {
    opacity: 1;
    transform: translateY(0px);
    transition: ${props => `
      opacity ${props.transitionDuration}ms linear ${props.transitionDelay}ms,
      transform ${props.transitionDuration}ms ${fastOutSlowIn} ${props.transitionDelay}ms
    `};
  }

  &.exit {
    opacity: 1;
  }

  &.exitActive {
    opacity: 0;
    transition: ${props => `opacity ${props.transitionDuration}ms linear`};
  }
`

export function NotificationsButton() {
  const dispatch = useAppDispatch()
  const map = useAppSelector(s => s.notifications.map)
  const ids = useAppSelector(s => s.notifications.ids)
  const group = ids.groupBy(id => map.get(id)?.local)
  const localNotifications = group.get(true)
  const serverNotifications = group.get(false)
  const hasUnread = useMemo(() => map.some(n => !n.read), [map])

  const [anchor, setAnchor] = useState<EventTarget | null>(null)
  const onClick = useCallback((event: React.MouseEvent) => {
    setAnchor(event.currentTarget)
  }, [])
  const onDismiss = useCallback(() => {
    setAnchor(null)
    if (localNotifications?.count()) {
      dispatch(markLocalNotificationsRead(localNotifications.valueSeq().toArray()))
    }
    if (serverNotifications?.count()) {
      dispatch(markNotificationsRead(serverNotifications.valueSeq().toArray()))
    }
  }, [localNotifications, serverNotifications, dispatch])
  const popoverContentsRef = useRef(null)

  return (
    <>
      <ButtonContainer>
        <IconButton
          icon={<FadedNotificationsIcon />}
          title={hasUnread ? 'Notifications (unread)' : 'Notifications'}
          onClick={onClick}
        />
        {hasUnread ? <UnreadIndicator /> : null}
      </ButtonContainer>
      <StyledLegacyPopover
        open={!!anchor}
        onDismiss={onDismiss}
        anchor={anchor}
        anchorOriginHorizontal='right'
        anchorOriginVertical='bottom'
        popoverOriginHorizontal='right'
        popoverOriginVertical='bottom'
        anchorOffsetHorizontal={-8}
        anchorOffsetVertical={-8}>
        {(
          state: string,
          timings: { openDelay: number; openDuration: number; closeDuration: number },
        ) => {
          const { openDelay, openDuration, closeDuration } = timings
          let transitionDuration = 0
          let transitionDelay = 0
          if (state === 'opening') {
            transitionDuration = openDuration
            transitionDelay = openDelay
          } else if (state === 'opened') {
            transitionDuration = closeDuration
          }

          return (
            <CSSTransition
              nodeRef={popoverContentsRef}
              in={state === 'opening' || state === 'opened'}
              classNames={transitionNames}
              appear={true}
              timeout={{
                appear: openDelay + openDuration,
                enter: openDuration,
                exit: closeDuration,
              }}>
              <PopoverContents
                key='contents'
                ref={popoverContentsRef}
                transitionDuration={transitionDuration}
                transitionDelay={transitionDelay}>
                <ConnectedNotificationsList />
              </PopoverContents>
            </CSSTransition>
          )
        }}
      </StyledLegacyPopover>
    </>
  )
}
