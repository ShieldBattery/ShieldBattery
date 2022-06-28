import React, { useCallback, useEffect, useRef } from 'react'
import { useStableCallback } from '../state-hooks'

export interface FocusTrapProps {
  children: React.ReactNode
  /**
   * An ref to focus initially, and when focus travels outside of the bounds of the children. This
   * should be an element somewhere inside of the children (optimally at the beginning of content).
   *
   * **Note:** This element **must** have a tabIndex set. If it should not normally be
   * keyboard-navigable, this can be `-1`, and should probably be `0` otherwise.
   */
  focusableRef: React.RefObject<HTMLElement>
}

/**
 * A component that locks focus to its children, if were to navigate past the beginning or end of
 * the children, it will be placed back at the beginning.
 */
export function FocusTrap({ children, focusableRef }: FocusTrapProps) {
  const topRef = useRef<HTMLSpanElement>(null)
  const bottomRef = useRef<HTMLSpanElement>(null)

  const onFocusTrap = useCallback(() => {
    focusableRef.current?.focus()
  }, [focusableRef])

  const focusOnMount = useStableCallback(() => {
    focusableRef.current?.focus()
    if (
      __WEBPACK_ENV.NODE_ENV !== 'production' &&
      !focusableRef.current?.hasAttribute('tabindex')
    ) {
      throw new Error('focusableRef must have a tabIndex set')
    }
  })
  useEffect(focusOnMount, [focusOnMount])

  return (
    <>
      <span ref={topRef} tabIndex={0} onFocus={onFocusTrap} />
      {children}
      <span ref={bottomRef} tabIndex={0} onFocus={onFocusTrap} />
    </>
  )
}
