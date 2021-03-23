import React, { useCallback, useMemo, useRef, useState } from 'react'
import { CSSTransition } from 'react-transition-group'
import styled from 'styled-components'
import NotificationsIcon from '../icons/material/notifications_black_24px.svg'
import { fastOutSlowIn } from '../material/curve-constants'
import IconButton from '../material/icon-button'
import Popover from '../material/popover'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { amberA200, colorTextSecondary } from '../styles/colors'
import { markNotificationsRead } from './action-creators'
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

const PopoverContents = styled.div<PopoverContentsProps>`
  width: 320px;
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
  const notifications = useAppSelector(s => s.notifications.list)
  const hasUnread = useMemo(() => notifications.some(n => n.unread), [notifications])

  const [anchor, setAnchor] = useState<EventTarget | null>(null)
  const onClick = useCallback((event: MouseEvent) => {
    setAnchor(event.currentTarget)
  }, [])
  const onDismiss = useCallback(() => {
    setAnchor(null)
    dispatch(markNotificationsRead())
  }, [])
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
      <Popover
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
      </Popover>
    </>
  )
}
