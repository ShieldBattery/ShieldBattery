import * as React from 'react'
import { useContext, useEffect, useMemo, useState } from 'react'
import { useValueAsRef } from '../react/state-hooks'

interface KeyHandler {
  keydown: (event: KeyboardEvent) => boolean
  keyup: (event: KeyboardEvent) => boolean
  keypress: (event: KeyboardEvent) => boolean
}

export interface KeyListenerProps {
  onKeyDown?: (event: KeyboardEvent) => boolean
  onKeyUp?: (event: KeyboardEvent) => boolean
  onKeyPress?: (event: KeyboardEvent) => boolean
}

/** @deprecated Prefer useKeyListener */
export default function KeyListener(props: KeyListenerProps) {
  useKeyListener(props)

  return null
}

/**
 * A hook that allows for listening to keypresses in a distributed way, while allowing for certain
 * component trees to handle keypresses exclusively while mounted.
 *
 * To mark a specific component tree as handling keypresses exclusively, place a
 * `KeyListenerBoundary` around it.
 *
 * All event handler props should return true if they've handled a particular event, and it
 * shouldn't be handled further.
 */
export function useKeyListener(props: KeyListenerProps) {
  const keydownRef = useValueAsRef(props.onKeyDown)
  const keyupRef = useValueAsRef(props.onKeyUp)
  const keypressRef = useValueAsRef(props.onKeyPress)

  const handler = useMemo<KeyHandler>(() => {
    return {
      keydown: event => Boolean(keydownRef.current && keydownRef.current(event)),
      keyup: event => Boolean(keyupRef.current && keyupRef.current(event)),
      keypress: event => Boolean(keypressRef.current && keypressRef.current(event)),
    }
  }, [keydownRef, keypressRef, keyupRef])

  const boundary = useContext(KeyListenerContext)

  useEffect(() => {
    if (!boundary) {
      throw new Error('KeyListener must be used within a KeyListenerContext')
    }
    boundary.addKeyHandler(handler)
    return () => boundary.removeKeyHandler(handler)
  }, [boundary, handler])
}

/**
 * The key handlers and active child boundaries registered with a single `KeyListenerBoundary`.
 * Key events are routed down from the root boundary: a boundary with any active child boundaries
 * passes events to the most recently activated one, so sibling modal UIs (e.g. a dialog opened
 * on top of the settings screen) receive keys in the order they were stacked. Only a boundary
 * without active children runs its own handlers.
 */
class Boundary {
  private handlers: KeyHandler[] = []
  private activeChildren: Boundary[] = []

  addKeyHandler(handler: KeyHandler) {
    this.handlers.push(handler)
  }

  removeKeyHandler(handler: KeyHandler) {
    removeFromArray(this.handlers, handler)
  }

  addActiveChild(child: Boundary) {
    this.activeChildren.push(child)
  }

  removeActiveChild(child: Boundary) {
    removeFromArray(this.activeChildren, child)
  }

  /** Returns true if a handler handled the event. */
  dispatch(event: KeyboardEvent): boolean {
    const child = this.activeChildren.at(-1)
    if (child) {
      return child.dispatch(event)
    }

    const handlerName = event.type
    if (handlerName !== 'keydown' && handlerName !== 'keyup' && handlerName !== 'keypress') {
      throw new Error('Unsupported event: ' + event.type)
    }

    const handlers = this.handlers
    for (let i = handlers.length - 1; i >= 0; i--) {
      if (handlers[i][handlerName](event)) {
        return true
      }
    }

    return false
  }
}

function removeFromArray<T>(array: T[], value: T) {
  const index = array.indexOf(value)
  if (index !== -1) {
    array.splice(index, 1)
  }
}

const KeyListenerContext = React.createContext<Boundary | undefined>(undefined)

/**
 * A boundary for `KeyListener`s and `useKeyListener` that stops keypresses from being handled
 * outside of it. This should be used for UIs that represent a modal state of some sort (for
 * example, a dialog or a popover).
 *
 * When multiple boundaries are active within the same parent boundary, only the one that became
 * active most recently receives keypresses.
 *
 * To work correctly, a `KeyListenerBoundary` must also be placed at the root of the application.
 */
export function KeyListenerBoundary({
  children,
  active = true,
}: {
  children: React.ReactNode
  active?: boolean
}) {
  const parentBoundary = useContext(KeyListenerContext)
  const [boundary] = useState(() => new Boundary())

  useEffect(() => {
    if (!active) {
      return undefined
    }

    if (parentBoundary) {
      parentBoundary.addActiveChild(boundary)
      return () => parentBoundary.removeActiveChild(boundary)
    }

    const onKeyEvent = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return

      if (boundary.dispatch(event)) {
        event.preventDefault()
      }
    }

    document.addEventListener('keydown', onKeyEvent)
    document.addEventListener('keyup', onKeyEvent)
    document.addEventListener('keypress', onKeyEvent)
    return () => {
      document.removeEventListener('keydown', onKeyEvent)
      document.removeEventListener('keyup', onKeyEvent)
      document.removeEventListener('keypress', onKeyEvent)
    }
  }, [boundary, parentBoundary, active])

  return (
    <KeyListenerContext.Provider value={active ? boundary : parentBoundary}>
      {children}
    </KeyListenerContext.Provider>
  )
}
