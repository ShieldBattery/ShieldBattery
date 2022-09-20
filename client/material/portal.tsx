import React, { useContext, useEffect, useRef } from 'react'
import ReactDOM from 'react-dom'
import { useExternalElementRef } from '../dom/use-external-element-ref'
import { useStableCallback } from '../state-hooks'
import { markEventAsHandledDismissal } from './dismissal-events'

function useDismissalClickHandler(
  onDismiss?: (event?: MouseEvent) => void,
): [
  onCapture: (event: MouseEvent, isContained: boolean) => void,
  onBubble: (event: MouseEvent) => void,
] {
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>()
  const capturedRef = useRef(false)
  // We capture the event and check if it will dismiss there, so that we can mark it as a
  // dismissal for other scrim or scrim-like handlers to avoid dismissing their UIs when a popover
  // is closed. We don't actually perform the dismissal until the event bubbles back up, however,
  // so that it is easier to make things that trigger portals/popovers act more like toggles (that
  // is, close if you click them again while open).
  const onCapture = useStableCallback((event: MouseEvent, isContained: boolean) => {
    if (onDismiss) {
      if (!isContained) {
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
  })
  const onBubble = useStableCallback((event: MouseEvent) => {
    if (onDismiss && capturedRef.current) {
      onDismiss(event)
    }

    capturedRef.current = false
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = undefined
    }
  })

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  return [onCapture, onBubble]
}

interface PortalContextValue {
  registerDescendant(descendant: PortalContextValue): void
  unregisterDescendant(descendant: PortalContextValue): void

  isEventContained(event: MouseEvent): boolean

  onCaptureClick: (event: MouseEvent) => void
  onBubbleClick: (event: MouseEvent) => void
  onCaptureContextMenu: (event: MouseEvent) => void
  onBubbleContextMenu: (event: MouseEvent) => void
}

const PortalContext = React.createContext<PortalContextValue | undefined>(undefined)

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

  const parentPortal = useContext(PortalContext)

  const portalRef = useExternalElementRef()
  const [onCaptureClick, onBubbleClick] = useDismissalClickHandler(onDismiss)
  const [onCaptureContextMenu, onBubbleContextMenu] = useDismissalClickHandler(onDismiss)

  portalRef.current.className = props.className ?? ''

  const descendantsRef = useRef<PortalContextValue[]>([])
  const containedEventsRef = useRef<WeakMap<MouseEvent, boolean>>(new WeakMap())

  const contextValue = React.useMemo<PortalContextValue>(
    () => ({
      registerDescendant(descendant) {
        descendantsRef.current.push(descendant)
      },

      unregisterDescendant(descendant) {
        descendantsRef.current.splice(descendantsRef.current.indexOf(descendant), 1)
      },

      isEventContained(event) {
        return (
          portalRef.current?.contains(event.target as Node) ||
          descendantsRef.current.some(d => d.isEventContained(event))
        )
      },

      onCaptureClick(event) {
        const isContained = this.isEventContained(event)
        if (isContained) {
          containedEventsRef.current.set(event, true)
        }

        onCaptureClick(event, isContained)
        for (const descendent of descendantsRef.current) {
          descendent.onCaptureClick(event)
        }
      },

      onCaptureContextMenu(event) {
        const isContained = this.isEventContained(event)
        if (isContained) {
          containedEventsRef.current.set(event, true)
        }

        onCaptureContextMenu(event, isContained)
        for (const descendent of descendantsRef.current) {
          descendent.onCaptureContextMenu(event)
        }
      },

      onBubbleClick(event) {
        for (let i = descendantsRef.current.length - 1; i >= 0; i--) {
          descendantsRef.current[i].onBubbleClick(event)
        }
        onBubbleClick(event)
      },

      onBubbleContextMenu(event) {
        for (let i = descendantsRef.current.length - 1; i >= 0; i--) {
          descendantsRef.current[i].onBubbleContextMenu(event)
        }
        onBubbleContextMenu(event)
      },
    }),
    [onBubbleClick, onBubbleContextMenu, onCaptureClick, onCaptureContextMenu, portalRef],
  )

  useEffect(() => {
    if (open) {
      if (!parentPortal) {
        // If this portal has no portal ancestors, it registers document handlers to deal with
        // clicks
        const captureClick = contextValue.onCaptureClick.bind(contextValue)
        document.addEventListener('click', captureClick, true /* useCapture */)
        const bubbleClick = contextValue.onBubbleClick.bind(contextValue)
        document.addEventListener('click', bubbleClick)
        const captureContext = contextValue.onCaptureContextMenu.bind(contextValue)
        document.addEventListener('contextmenu', captureContext, true /* useCapture */)
        const bubbleContext = contextValue.onBubbleContextMenu.bind(contextValue)
        document.addEventListener('contextmenu', bubbleContext)
        return () => {
          document.removeEventListener('click', captureClick, true /* useCapture */)
          document.removeEventListener('click', bubbleClick)
          document.removeEventListener('contextmenu', captureContext, true /* useCapture */)
          document.removeEventListener('contextmenu', bubbleContext)
        }
      } else {
        // If this portal does have portal ancestors, one of those ancestors will handle the clicks
        // and pass them down to us, so we just register ourselves as a descendant to receive them
        parentPortal.registerDescendant(contextValue)
        return () => {
          parentPortal.unregisterDescendant(contextValue)
        }
      }
    }

    // makes the linter happy :)
    return undefined
  }, [
    onCaptureClick,
    onBubbleClick,
    onCaptureContextMenu,
    onBubbleContextMenu,
    open,
    parentPortal,
    contextValue,
  ])

  return ReactDOM.createPortal(
    <PortalContext.Provider value={contextValue}>{children}</PortalContext.Provider>,
    portalRef.current,
  )
}
