import React, { useCallback, useEffect, useRef } from 'react'
import ReactDOM from 'react-dom'
import { useExternalElementRef } from '../dom/use-external-element-ref'
import { markEventAsHandledDismissal } from './dismissal-events'

export interface PortalProps {
  /** Children rendered inside the Portal. */
  children: React.ReactNode
  /** Whether or not the portal contents should be shown/rendered */
  open: boolean
  /**
   * Function called when the portal is being dismissed by clicking outside of its contents. This
   * function should generally result in the `open` prop being set to `false`.
   */
  onDismiss?: () => void
}

/**
 * Renders component trees into 'portals', that is, roots that exist outside of the React root. This
 * is useful for things like modal dialogs, popovers, etc. Contains functionality for being
 * dismissed when a click-away occurs (clicks always propagate as well, though).
 */
export function Portal(props: PortalProps) {
  const { onDismiss, open, children } = props

  const portalRef = useExternalElementRef()
  const capturedClickRef = useRef(false)
  // We capture the event and check if it will dismiss there, so that we can mark it as a
  // dismissal for other scrim or scrim-like handlers to avoid dismissing their UIs when a popover
  // is closed. We don't actually perform the dismissal until the event bubbles back up, however,
  // so that it is easier to make things that trigger portals/popovers act more like toggles (that
  // is, close if you click them again while open).
  const onCaptureClick = useCallback(
    (event: MouseEvent) => {
      if (onDismiss) {
        if (!portalRef.current?.contains(event.target as Node)) {
          markEventAsHandledDismissal(event)
          capturedClickRef.current = true
        }
      }
    },
    [onDismiss, portalRef],
  )
  const onBubbleClick = useCallback(
    (event: MouseEvent) => {
      if (onDismiss && capturedClickRef.current) {
        onDismiss()
      }

      capturedClickRef.current = false
    },
    [onDismiss],
  )

  // We don't use the capture/bubble trick for right-clicks since we want to show the context menu
  // every time they happen, even if it's on the same element.
  const onContextMenu = useCallback(
    (event: MouseEvent) => {
      if (onDismiss) {
        if (!portalRef.current?.contains(event.target as Node)) {
          markEventAsHandledDismissal(event)
          onDismiss()
        }
      }
    },
    [onDismiss, portalRef],
  )

  useEffect(() => {
    if (open) {
      document.addEventListener('click', onCaptureClick, true /* useCapture */)
      document.addEventListener('click', onBubbleClick)
      document.addEventListener('contextmenu', onContextMenu, true /* useCapture */)
      return () => {
        document.removeEventListener('click', onCaptureClick, true /* useCapture */)
        document.removeEventListener('click', onBubbleClick)
        document.removeEventListener('contextmenu', onContextMenu, true /* useCapture */)
      }
    }

    // makes the linter happy :)
    return undefined
  }, [onCaptureClick, onBubbleClick, onContextMenu, open])

  return ReactDOM.createPortal(children, portalRef.current)
}
