import React, {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { animated, useTransition } from 'react-spring'
import styled from 'styled-components'
import { Snackbar } from '../material/snackbar'
import { defaultSpring } from '../material/springs'
import { zIndexSnackbar } from '../material/zindex'
import {
  registerSnackbarController,
  SnackbarController,
  SnackbarOptions,
  unregisterSnackbarController,
} from './snackbar-controller-registry'
import { DURATION_SHORT } from './snackbar-durations'

interface QueuedSnackbar {
  message: string
  durationMillis: number
  options?: SnackbarOptions
}

// test
const SnackbarControllerContext = React.createContext<SnackbarController>({
  showSnackbar: () => {},
})

export function useSnackbarController() {
  return useContext(SnackbarControllerContext)
}

const AnimatedContainer = styled(animated.div)`
  position: fixed;
  left: 50%;
  top: calc(var(--sb-system-bar-height, 0px) + var(--sb-app-bar-height, 0px) + 24px);
  transform: translate(-50%, 0%);

  z-index: ${zIndexSnackbar};
`

/**
 * Container component that provides a controller via `useSnackbarController` to any descendants and
 * will display snackbars over top of any content it contains when requested.
 */
export function SnackbarOverlay({ children }: { children: React.ReactNode }) {
  const [displayedSnackbar, setDisplayedSnackbar] = useState<QueuedSnackbar>()
  // TODO(tec27): Would probably be nice to reset/hold the timer when the user mouses over the
  // snackbar and/or focuses anything inside it
  const timerRef = useRef<ReturnType<typeof setTimeout>>()
  const [queue, setQueue] = useState<QueuedSnackbar[]>([])
  const controller = useMemo<SnackbarController>(
    () => ({
      showSnackbar(message, durationMillis = DURATION_SHORT, options) {
        setQueue(q => [...q, { message, durationMillis, options }])
      },
    }),
    [],
  )

  const onDismiss = useCallback(() => {
    setDisplayedSnackbar(undefined)
    if (timerRef.current) {
      clearTimeout(timerRef.current)
    }
    timerRef.current = undefined
  }, [])

  const transition = useTransition(displayedSnackbar, {
    from: {
      opacity: 0,
      transform: 'translate(-50%, -100%)',
      pointerEvents: 'auto' as 'auto' | 'none',
    },
    enter: {
      opacity: 1,
      transform: 'translate(-50%, 0%)',
      pointerEvents: 'auto' as 'auto' | 'none',
    },
    leave: {
      opacity: -0.5,
      transform: 'translate(-50%, -200%)',
      pointerEvents: 'none' as 'auto' | 'none',
    },
    config: (item, index, phase) => key =>
      phase === 'leave' || key === 'opacity' ? { ...defaultSpring, clamp: true } : defaultSpring,
    exitBeforeEnter: true,
    onRest: () => {
      if (displayedSnackbar) {
        timerRef.current = setTimeout(() => {
          onDismiss()
        }, displayedSnackbar.durationMillis)
      }
    },
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
      {transition((style, item) =>
        item ? (
          <AnimatedContainer style={style}>
            <Snackbar
              message={item.message}
              actionLabel={item.options?.action?.label}
              onAction={item.options?.action?.onClick}
              onDismiss={onDismiss}
            />
          </AnimatedContainer>
        ) : undefined,
      )}
    </SnackbarControllerContext.Provider>
  )
}
