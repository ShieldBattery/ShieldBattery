import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react'

export const START_GAME_HOLD_MS = 2_000

const HOLD_HINT_MS = 2_000

type HoldInput =
  | {
      kind: 'keyboard'
      key: ' ' | 'Enter'
    }
  | {
      kind: 'pointer'
      pointerId: number
    }

export interface StartGameHoldOptions {
  allReady: boolean
  disabled: boolean
  onStartGame: () => void
  onForceStart: () => void
}

/**
 * Separates an ordinary start click from the deliberate hold needed to bypass player readiness.
 * Native clicks following a held input are consumed so a readiness update cannot turn an
 * interrupted force-start gesture into an ordinary start.
 */
export function useStartGameHold({
  allReady,
  disabled,
  onStartGame,
  onForceStart,
}: StartGameHoldOptions) {
  const [isHolding, setIsHolding] = useState(false)
  const [showHoldHint, setShowHoldHint] = useState(false)
  const [availability, setAvailability] = useState({ allReady, disabled })
  if (availability.allReady !== allReady || availability.disabled !== disabled) {
    setAvailability({ allReady, disabled })
    setIsHolding(false)
    setShowHoldHint(false)
  }
  const holdRef = useRef<HoldInput | undefined>(undefined)
  const pointerPressRef = useRef<number | undefined>(undefined)
  const keyboardPressRef = useRef<' ' | 'Enter' | undefined>(undefined)
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const hintTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const suppressNextClickRef = useRef(false)
  const onForceStartRef = useRef(onForceStart)

  useEffect(() => {
    onForceStartRef.current = onForceStart
  }, [onForceStart])

  function clearHoldTimer() {
    if (holdTimerRef.current !== undefined) {
      clearTimeout(holdTimerRef.current)
      holdTimerRef.current = undefined
    }
  }

  function cancelActiveHold({ consumeClick = false }: { consumeClick?: boolean } = {}) {
    const input = holdRef.current
    clearHoldTimer()
    holdRef.current = undefined
    suppressNextClickRef.current ||= consumeClick && input !== undefined
  }

  function cancelHold(options?: { consumeClick?: boolean }) {
    cancelActiveHold(options)
    setIsHolding(false)
  }

  function showHint() {
    if (hintTimerRef.current !== undefined) {
      clearTimeout(hintTimerRef.current)
    }

    setShowHoldHint(true)
    hintTimerRef.current = setTimeout(() => {
      hintTimerRef.current = undefined
      setShowHoldHint(false)
    }, HOLD_HINT_MS)
  }

  function startHold(input: HoldInput) {
    holdRef.current = input
    suppressNextClickRef.current = true
    setShowHoldHint(false)
    setIsHolding(true)
    holdTimerRef.current = setTimeout(() => {
      const activeInput = holdRef.current
      if (activeInput !== input) {
        return
      }

      holdTimerRef.current = undefined
      holdRef.current = undefined
      setIsHolding(false)
      onForceStartRef.current()
    }, START_GAME_HOLD_MS)
  }

  const cancelActiveForUnavailableState = useEffectEvent(() => {
    cancelActiveHold({ consumeClick: true })
    if (disabled) {
      pointerPressRef.current = undefined
      keyboardPressRef.current = undefined
    }
  })

  useLayoutEffect(() => {
    if (allReady || disabled) {
      cancelActiveForUnavailableState()
    }
  }, [allReady, disabled])

  function cancelHoldForInterruption() {
    cancelHold({ consumeClick: true })
    pointerPressRef.current = undefined
    keyboardPressRef.current = undefined
  }

  const cancelForGlobalInterruption = useEffectEvent(() => {
    cancelHoldForInterruption()
  })

  useEffect(() => {
    const onWindowBlur = () => cancelForGlobalInterruption()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        cancelForGlobalInterruption()
      }
    }

    window.addEventListener('blur', onWindowBlur)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('blur', onWindowBlur)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  useLayoutEffect(() => {
    return () => {
      clearHoldTimer()
      if (hintTimerRef.current !== undefined) {
        clearTimeout(hintTimerRef.current)
      }
    }
  }, [])

  const buttonProps = {
    onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0 || !event.isPrimary) {
        return
      }

      if (pointerPressRef.current !== undefined || keyboardPressRef.current !== undefined) {
        event.preventDefault()
        return
      }

      suppressNextClickRef.current = false
      if (disabled || allReady) {
        return
      }

      event.preventDefault()
      event.currentTarget.focus({ preventScroll: true })
      pointerPressRef.current = event.pointerId
      event.currentTarget.setPointerCapture?.(event.pointerId)
      startHold({ kind: 'pointer', pointerId: event.pointerId })
    },
    onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => {
      const input = holdRef.current
      if (input?.kind !== 'pointer' || input.pointerId !== event.pointerId) {
        return
      }

      const bounds = event.currentTarget.getBoundingClientRect()
      if (
        event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom
      ) {
        cancelHold({ consumeClick: true })
      }
    },
    onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (pointerPressRef.current !== event.pointerId) {
        return
      }

      event.preventDefault()
      pointerPressRef.current = undefined
      const input = holdRef.current
      if (input?.kind === 'pointer' && input.pointerId === event.pointerId) {
        cancelHold({ consumeClick: true })
        showHint()
      }
    },
    onPointerLeave: (event: React.PointerEvent<HTMLButtonElement>) => {
      const input = holdRef.current
      if (input?.kind === 'pointer' && input.pointerId === event.pointerId) {
        cancelHold({ consumeClick: true })
      }
    },
    onPointerCancel: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (pointerPressRef.current === event.pointerId) {
        pointerPressRef.current = undefined
        cancelHold()
      }
    },
    onLostPointerCapture: (event: React.PointerEvent<HTMLButtonElement>) => {
      if (pointerPressRef.current === event.pointerId) {
        pointerPressRef.current = undefined
        cancelHold()
      }
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'Escape') {
        if (holdRef.current) {
          event.preventDefault()
          cancelHold({ consumeClick: true })
        }
        return
      }

      if (event.key !== ' ' && event.key !== 'Enter') {
        return
      }

      if (keyboardPressRef.current !== undefined || event.repeat) {
        event.preventDefault()
        return
      }

      if (pointerPressRef.current !== undefined) {
        event.preventDefault()
        return
      }

      if (disabled || allReady) {
        suppressNextClickRef.current = false
        return
      }

      event.preventDefault()
      keyboardPressRef.current = event.key
      startHold({ kind: 'keyboard', key: event.key })
    },
    onKeyUp: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (keyboardPressRef.current !== event.key) {
        return
      }

      event.preventDefault()
      keyboardPressRef.current = undefined
      const input = holdRef.current
      if (input?.kind === 'keyboard' && input.key === event.key) {
        cancelHold({ consumeClick: true })
        showHint()
      }
    },
    onBlur: () => {
      if (
        holdRef.current ||
        pointerPressRef.current !== undefined ||
        keyboardPressRef.current !== undefined
      ) {
        cancelHoldForInterruption()
      }
    },
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
      if (pointerPressRef.current !== undefined || keyboardPressRef.current !== undefined) {
        event.preventDefault()
        return
      }

      if (suppressNextClickRef.current) {
        event.preventDefault()
        suppressNextClickRef.current = false
        return
      }

      if (disabled) {
        event.preventDefault()
        return
      }

      if (allReady) {
        onStartGame()
      } else {
        event.preventDefault()
        showHint()
      }
    },
  }

  return {
    isHolding: isHolding && !allReady && !disabled,
    showHoldHint: showHoldHint && !allReady && !disabled,
    buttonProps,
  }
}
