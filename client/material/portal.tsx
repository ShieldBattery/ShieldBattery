import React, { useCallback, useEffect } from 'react'
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
  const onClick = useCallback(
    (event: MouseEvent) => {
      if (onDismiss) {
        if (!portalRef.current?.contains(event.target as Node)) {
          onDismiss()
          markEventAsHandledDismissal(event)
        }
      }
    },
    [onDismiss, portalRef],
  )

  useEffect(() => {
    if (open) {
      document.addEventListener('click', onClick, true /* useCapture */)
      return () => {
        document.removeEventListener('click', onClick, true /* useCapture */)
      }
    }

    // makes the linter happy :)
    return undefined
  }, [onClick, open])

  return ReactDOM.createPortal(children, portalRef.current)
}
