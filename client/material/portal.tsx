import { rgba } from 'polished'
import React, { useCallback, useEffect, useRef } from 'react'
import ReactDOM from 'react-dom'
import { CSSTransition, TransitionGroup } from 'react-transition-group'
import styled from 'styled-components'
import { dialogScrim } from '../styles/colors'
import { zIndexDialogScrim } from './zindex'

const transitionNames = {
  appear: 'enter',
  appearActive: 'enterActive',
  enter: 'enter',
  enterActive: 'enterActive',
  exit: 'exit',
  exitActive: 'exitActive',
}

const Scrim = styled.div`
  position: fixed;
  left: 0;
  top: var(--sb-system-bar-height, 0);
  right: 0;
  bottom: 0;

  background-color: ${rgba(dialogScrim, 0.42)};
  /*
    Even though we're using React's CSS Transition Group to animate the scrim with the classes below
    we also have a transition of "opacity" property here, because it is possible in some special
    case (Dialogs) for scrim to always be rendered.
  */
  transition: opacity 250ms linear;
  -webkit-app-region: no-drag;

  &.enter {
    background-color: ${rgba(dialogScrim, 0)};
  }

  &.enterActive {
    background-color: ${rgba(dialogScrim, 0.42)};
    transition: background-color 250ms linear;
  }

  &.exit {
  }

  &.exitActive {
    transition: background-color 200ms linear;
    background-color: ${rgba(dialogScrim, 0)};
  }
`

export interface PortalProps {
  /** Called to render the children inside the portal, will only be called if `open` is `true`. */
  children: () => React.ReactNode
  /** Whether or not the portal contents should be shown/rendered */
  open: boolean

  /**
   * Whether or not to show the scrim (that is, darken the background behind the Portal). Defaults
   * to false.
   */
  scrim?: boolean
  /**
   * The z-index to apply to the scrim layer. Defaults to dialog level.
   */
  scrimZIndex?: number
  /**
   * Whether clicks should be propagated to the content behind the Portal. Only usable when the
   * scrim is not visible. Defaults to false.
   */
  propagateClicks?: boolean
  /**
   * Function called when the portal is being dismissed by clicking outside of its contents. This
   * function should generally result in the `open` prop being set to `false`.
   */
  onDismiss?: () => void
}

/**
 * Renders component trees into 'portals', that is, roots that exist outside of the React root. This
 * is useful for things like modal dialogs, popovers, etc. Contains functionality for being
 * dismissed when a click-away occurs, and can optionally scrim the screen behind the portal
 * content. If a scrim is displayed, clicks will not propagate to the elements behind it. If a scrim
 * is not displayed though, the propagation of clicks to the elements behind it can be configured
 * with `propagateClicks` props.
 */
export function Portal(props: PortalProps) {
  const portalRef = useRef(document.createElement('div'))

  const { onDismiss, open, scrim, scrimZIndex, propagateClicks, children } = props

  const onClickAway = useCallback(() => {
    if (onDismiss && open) {
      onDismiss()
    }
  }, [onDismiss, open])

  useEffect(() => {
    const portalElem = portalRef.current
    document.body.appendChild(portalRef.current)

    return () => {
      document.body.removeChild(portalElem)
    }
  }, [])

  const scrimStyle: React.CSSProperties = {
    opacity: scrim ? 1 : 0,
    zIndex: scrimZIndex || zIndexDialogScrim,
  }
  if (propagateClicks) {
    scrimStyle.visibility = scrim ? 'visible' : 'hidden'
  }

  return ReactDOM.createPortal(
    <>
      <TransitionGroup>
        {open ? (
          <CSSTransition
            classNames={transitionNames}
            appear={true}
            timeout={{ appear: 250, enter: 250, exit: 200 }}>
            <Scrim key={'scrim'} style={scrimStyle} onClick={onClickAway} />
          </CSSTransition>
        ) : null}
      </TransitionGroup>
      {open ? children() : null}
    </>,
    portalRef.current,
  )
}
