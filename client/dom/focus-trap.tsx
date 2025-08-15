import * as React from 'react'
import { useCallback, useEffect, useRef } from 'react'

export interface FocusTrapProps {
  children: React.ReactNode
  /**
   * An element to focus initially, and when focus travels outside of the bounds of the children.
   * This should be an element somewhere inside of the children (optimally at the beginning of
   * content).
   *
   * **Note:** This element **must** have a tabIndex set. If it should not normally be
   * keyboard-navigable, this can be `-1`, and should probably be `0` otherwise.
   */
  focusableElem: HTMLElement | null
  /**
   * Whether the focus trap should steal the focus when it is mounted. Defaults to `true`.
   */
  focusOnMount?: boolean
}

/**
 * A component that locks focus to its children, if were to navigate past the beginning or end of
 * the children, it will be placed back at the beginning.
 */
export function FocusTrap({ children, focusableElem, focusOnMount = true }: FocusTrapProps) {
  const topRef = useRef<HTMLSpanElement>(null)
  const bottomRef = useRef<HTMLSpanElement>(null)

  const onFocusTrap = useCallback(() => {
    focusableElem?.focus()
  }, [focusableElem])

  useEffect(() => {
    if (focusOnMount) {
      focusableElem?.focus()
    }
    if (
      __WEBPACK_ENV.NODE_ENV !== 'production' &&
      focusableElem &&
      !focusableElem?.hasAttribute('tabindex')
    ) {
      throw new Error('focusableElem must have a tabIndex set')
    }
  }, [focusOnMount, focusableElem])

  return (
    <>
      <span ref={topRef} tabIndex={0} onFocus={onFocusTrap} />
      {children}
      <span ref={bottomRef} tabIndex={0} onFocus={onFocusTrap} />
    </>
  )
}
