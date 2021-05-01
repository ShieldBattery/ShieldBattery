import { rgba } from 'polished'
import React, { useCallback, useEffect, useRef } from 'react'
import ReactDOM from 'react-dom'
import { animated, useTransition } from 'react-spring'
import styled from 'styled-components'
import { dialogScrim } from '../styles/colors'

const Scrim = styled(animated.div)`
  position: fixed;
  left: 0;
  top: var(--sb-system-bar-height, 0);
  right: 0;
  bottom: 0;

  -webkit-app-region: no-drag;
`

export interface PortalProps {
  /** Children rendered inside the Portal. */
  children: React.ReactNode
  /** Whether or not the portal contents should be shown/rendered */
  open: boolean
  /**
   * Whether or not to show the scrim (that is, darken the background behind the Portal). Defaults
   * to false.
   */
  scrim?: boolean
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

const INVISIBLE_SCRIM_COLOR = rgba(dialogScrim, 0)
const VISIBLE_SCRIM_COLOR = rgba(dialogScrim, 0.42)

/**
 * Renders component trees into 'portals', that is, roots that exist outside of the React root. This
 * is useful for things like modal dialogs, popovers, etc. Contains functionality for being
 * dismissed when a click-away occurs, and can optionally scrim the screen behind the portal
 * content. If a scrim is displayed, clicks will not propagate to the elements behind it. If a scrim
 * is not displayed though, the propagation of clicks to the elements behind it can be configured
 * with `propagateClicks` props.
 */
export function Portal(props: PortalProps) {
  const { onDismiss, open, scrim, propagateClicks, children } = props

  const portalRef = useRef(document.createElement('div'))
  const onClickAway = useCallback(() => {
    if (onDismiss && open) {
      onDismiss()
    }
  }, [onDismiss, open])
  const scrimTransition = useTransition(open, {
    from: {
      background: INVISIBLE_SCRIM_COLOR,
    },
    enter: { background: scrim ? VISIBLE_SCRIM_COLOR : INVISIBLE_SCRIM_COLOR },
    update: { background: scrim ? VISIBLE_SCRIM_COLOR : INVISIBLE_SCRIM_COLOR },
    leave: { background: INVISIBLE_SCRIM_COLOR },
  })
  useEffect(() => {
    const portalElem = portalRef.current
    document.body.appendChild(portalRef.current)

    return () => {
      document.body.removeChild(portalElem)
    }
  }, [])

  return ReactDOM.createPortal(
    <>
      {scrimTransition(
        (styles, open) =>
          open && (
            <Scrim
              style={{
                visibility: propagateClicks && !scrim ? 'hidden' : 'visible',
                ...styles,
              }}
              onClick={onClickAway}
            />
          ),
      )}
      {open ? children : null}
    </>,
    portalRef.current,
  )
}
