import { AnimatePresence, Transition, Variants } from 'motion/react'
import * as m from 'motion/react-m'
import * as React from 'react'
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'
import { Snackbar } from '../material/snackbar'
import { zIndexSnackbar } from '../material/zindex'
import { useStableCallback } from '../react/state-hooks'
import {
  registerSnackbarController,
  SnackbarController,
  SnackbarOptions,
  unregisterSnackbarController,
} from './snackbar-controller-registry'
import { DURATION_SHORT } from './snackbar-durations'

interface QueuedSnackbar {
  id: number
  message: string
  durationMillis: number
  options?: SnackbarOptions
}

const SnackbarControllerContext = React.createContext<SnackbarController>({
  showSnackbar: () => {},
})

export function useSnackbarController() {
  return useContext(SnackbarControllerContext)
}

const AnimatedContainer = styled(m.div)`
  position: fixed;
  left: 50%;
  top: calc(var(--sb-system-bar-height, 0px) + var(--sb-app-bar-height, 0px) + 24px);
  transform: translate(-50%, 0%);

  z-index: ${zIndexSnackbar};
`

const snackbarVariants: Variants = {
  initial: {
    opacity: 0,
    y: -100,
    translateX: '-50%',
    pointerEvents: 'none',
  },
  visible: {
    opacity: 1,
    y: 0,
    translateX: '-50%',
    pointerEvents: 'auto',
  },
  exit: {
    opacity: 0,
    y: -200,
    translateX: '-50%',
    pointerEvents: 'none',
  },
}

const transition: Transition = {
  default: { type: 'spring', duration: 0.4 },
  opacity: { type: 'spring', duration: 0.3, bounce: 0 },
}

/**
 * Container component that provides a controller via `useSnackbarController` to any descendants and
 * will display snackbars over top of any content it contains when requested.
 */
export function SnackbarOverlay({ children }: { children: React.ReactNode }) {
  const idRef = useRef(0)
  const [displayedSnackbar, setDisplayedSnackbar] = useState<QueuedSnackbar>()
  const [isHovering, setIsHovering] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [queue, setQueue] = useState<QueuedSnackbar[]>([])
  const controller = useMemo<SnackbarController>(
    () => ({
      showSnackbar(message, durationMillis = DURATION_SHORT, options) {
        setQueue(q => [...q, { id: idRef.current, message, durationMillis, options }])
        idRef.current = (idRef.current + 1) % Number.MAX_SAFE_INTEGER
      },
    }),
    [],
  )

  const onDismiss = useStableCallback(() => {
    setDisplayedSnackbar(undefined)
    setIsHovering(false)
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }
    timerRef.current = undefined
  })

  const startDismissTimer = useStableCallback((duration: number) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }

    timerRef.current = setTimeout(() => {
      onDismiss()
    }, duration)
  })

  const onAnimationComplete = useStableCallback((definition: string) => {
    if (definition === 'visible' && displayedSnackbar && !isHovering) {
      startDismissTimer(displayedSnackbar.durationMillis)
    }
  })

  const onMouseEnter = useStableCallback(() => {
    setIsHovering(true)
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = undefined
    }
  })

  const onMouseLeave = useStableCallback(() => {
    setIsHovering(false)
    if (displayedSnackbar) {
      // Use half the original duration when hover ends
      startDismissTimer(Math.round(displayedSnackbar.durationMillis / 2))
    }
  })

  useEffect(() => {
    registerSnackbarController(controller)
    return () => {
      unregisterSnackbarController(controller)
    }
  }, [controller])

  useLayoutEffect(() => {
    if (displayedSnackbar) {
      const onAbort = () => {
        setDisplayedSnackbar(undefined)
        if (timerRef.current) {
          clearTimeout(timerRef.current)
        }
        timerRef.current = undefined
      }
      const signal = displayedSnackbar.options?.signal
      if (signal?.aborted) {
        onAbort()
        return () => {}
      }

      signal?.addEventListener('abort', onAbort)
      return () => {
        signal?.removeEventListener('abort', onAbort)
      }
    } else if (queue.length > 0) {
      setDisplayedSnackbar(queue[0])
      setQueue(q => q.slice(1))
    }

    return () => {}
  }, [queue, displayedSnackbar])

  return (
    <SnackbarControllerContext.Provider value={controller}>
      {children}
      <AnimatePresence mode='wait'>
        {displayedSnackbar && (
          <AnimatedContainer
            key={displayedSnackbar.id}
            variants={snackbarVariants}
            initial='initial'
            animate='visible'
            exit='exit'
            transition={transition}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            onTouchStart={onMouseEnter}
            onTouchEnd={onMouseLeave}
            onAnimationComplete={onAnimationComplete}>
            <Snackbar
              message={displayedSnackbar.message}
              actionLabel={displayedSnackbar.options?.action?.label}
              onAction={displayedSnackbar.options?.action?.onClick}
              onDismiss={onDismiss}
            />
          </AnimatedContainer>
        )}
      </AnimatePresence>
    </SnackbarControllerContext.Provider>
  )
}
