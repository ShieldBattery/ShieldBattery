import React, { useCallback, useEffect } from 'react'
import ReactDOM from 'react-dom'
import { useExternalElementRef } from '../dom/use-external-element-ref'
import { isHandledDismissalEvent, markEventAsHandledDismissal } from './dismissal-events'

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
        }
      }
    },
    [onDismiss, portalRef],
  )
  const onBubbleClick = useCallback(
    (event: MouseEvent) => {
      if (onDismiss && isHandledDismissalEvent(event)) {
        onDismiss()
      }
    },
    [onDismiss],
  )

  useEffect(() => {
    if (open) {
      document.addEventListener('click', onCaptureClick, true /* useCapture */)
      document.addEventListener('click', onBubbleClick)
      return () => {
        document.removeEventListener('click', onCaptureClick, true /* useCapture */)
        document.removeEventListener('click', onBubbleClick)
      }
    }

    // makes the linter happy :)
    return undefined
  }, [onCaptureClick, onBubbleClick, open])

  return ReactDOM.createPortal(children, portalRef.current)
}
