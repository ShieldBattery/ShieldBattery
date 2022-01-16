import React, { useCallback, useEffect, useRef } from 'react'
import ReactDOM from 'react-dom'
import { useExternalElementRef } from '../dom/use-external-element-ref'
import { markEventAsHandledDismissal } from './dismissal-events'

function useDismissalClickHandler(
  portalRef: React.MutableRefObject<HTMLDivElement>,
  onDismiss?: (event?: MouseEvent) => void,
) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>()
  const capturedRef = useRef(false)
  // We capture the event and check if it will dismiss there, so that we can mark it as a
  // dismissal for other scrim or scrim-like handlers to avoid dismissing their UIs when a popover
  // is closed. We don't actually perform the dismissal until the event bubbles back up, however,
  // so that it is easier to make things that trigger portals/popovers act more like toggles (that
  // is, close if you click them again while open).
  const onCapture = useCallback(
    (event: MouseEvent) => {
      if (onDismiss) {
        if (!portalRef.current?.contains(event.target as Node)) {
          markEventAsHandledDismissal(event)
          capturedRef.current = true

          // NOTE(tec27): We use a timeout here because queueMicrotask seems to happen too quickly
          // (between the capture and the bubble :( )
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current)
          }
          timeoutRef.current = setTimeout(() => {
            capturedRef.current = false
          }, 10)
        }
      }
    },
    [onDismiss, portalRef],
  )
  const onBubble = useCallback(
    (event: MouseEvent) => {
      if (onDismiss && capturedRef.current) {
        onDismiss(event)
      }

      capturedRef.current = false
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = undefined
      }
    },
    [onDismiss],
  )

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  return [onCapture, onBubble]
}

export interface PortalProps {
  className?: string
  /** Children rendered inside the Portal. */
  children: React.ReactNode
  /** Whether or not the portal contents should be shown/rendered */
  open: boolean
  /**
   * Function called when the portal is being dismissed by clicking outside of its contents. This
   * function should generally result in the `open` prop being set to `false`.
   */
  onDismiss?: (event?: MouseEvent) => void
}

/**
 * Renders component trees into 'portals', that is, roots that exist outside of the React root. This
 * is useful for things like modal dialogs, popovers, etc. Contains functionality for being
 * dismissed when a click-away occurs (clicks always propagate as well, though).
 */
export function Portal(props: PortalProps) {
  const { onDismiss, open, children } = props

  const portalRef = useExternalElementRef()
  const [onCaptureClick, onBubbleClick] = useDismissalClickHandler(portalRef, onDismiss)
  const [onCaptureContextMenu, onBubbleContextMenu] = useDismissalClickHandler(portalRef, onDismiss)

  portalRef.current.className = props.className ?? ''

  useEffect(() => {
    if (open) {
      document.addEventListener('click', onCaptureClick, true /* useCapture */)
      document.addEventListener('click', onBubbleClick)
      document.addEventListener('contextmenu', onCaptureContextMenu, true /* useCapture */)
      document.addEventListener('contextmenu', onBubbleContextMenu)
      return () => {
        document.removeEventListener('click', onCaptureClick, true /* useCapture */)
        document.removeEventListener('click', onBubbleClick)
        document.removeEventListener('contextmenu', onCaptureContextMenu, true /* useCapture */)
        document.removeEventListener('contextmenu', onBubbleContextMenu)
      }
    }

    // makes the linter happy :)
    return undefined
  }, [onCaptureClick, onBubbleClick, onCaptureContextMenu, onBubbleContextMenu, open])

  return ReactDOM.createPortal(children, portalRef.current)
}
