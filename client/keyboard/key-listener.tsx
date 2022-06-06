import React, { useContext, useEffect, useMemo, useRef } from 'react'
import { useStableCallback, useValueAsRef } from '../state-hooks'

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

  const context = useContext(KeyListenerContext)

  useEffect(() => {
    if (!context) {
      throw new Error('KeyListener must be used within a KeyListenerContext')
    }
    context?.addKeyHandler(handler)
    return () => context?.removeKeyHandler(handler)
  }, [context, handler])
}

interface KeyListenerContextValue {
  addKeyHandler: (handler: KeyHandler) => void
  removeKeyHandler: (handler: KeyHandler) => void

  enterExclusiveMode: () => void
  exitExclusiveMode: () => void
}

const KeyListenerContext = React.createContext<KeyListenerContextValue | undefined>(undefined)

/**
 * A boundary for `KeyListener`s and `useKeyListener` that stops keypresses from being handled
 * outside of it. This should be used for UIs that represent a modal state of some sort (for
 * example, a dialog or a popover).
 *
 * To work correctly, a `KeyListenerBoundary` must also be placed at the root of the application.
 */
export function KeyListenerBoundary({ children }: { children: React.ReactNode }) {
  const parentBoundary = useContext(KeyListenerContext)

  const handlersRef = useRef<KeyHandler[]>([])

  const onKeyEvent = useStableCallback((event: KeyboardEvent) => {
    if (event.defaultPrevented) return

    const handlerName = event.type
    if (handlerName !== 'keydown' && handlerName !== 'keyup' && handlerName !== 'keypress') {
      throw new Error('Unsupported event: ' + event.type)
    }

    const handlers = handlersRef.current

    let handled = false
    for (let i = handlers.length - 1; !handled && i >= 0; i--) {
      handled = handlers[i][handlerName](event)
    }

    if (handled) {
      event.preventDefault()
    }
  })

  const value = useMemo<KeyListenerContextValue>(
    () => ({
      addKeyHandler(handler) {
        if (!handlersRef.current.length) {
          document.addEventListener('keydown', onKeyEvent)
          document.addEventListener('keyup', onKeyEvent)
          document.addEventListener('keypress', onKeyEvent)
        }

        handlersRef.current.push(handler)
      },

      removeKeyHandler(handler) {
        handlersRef.current.splice(handlersRef.current.indexOf(handler), 1)

        if (!handlersRef.current.length) {
          document.removeEventListener('keydown', onKeyEvent)
          document.removeEventListener('keyup', onKeyEvent)
          document.removeEventListener('keypress', onKeyEvent)
        }
      },

      enterExclusiveMode() {
        if (handlersRef.current.length) {
          document.removeEventListener('keydown', onKeyEvent)
          document.removeEventListener('keyup', onKeyEvent)
          document.removeEventListener('keypress', onKeyEvent)
        }
      },

      exitExclusiveMode() {
        if (handlersRef.current.length) {
          document.addEventListener('keydown', onKeyEvent)
          document.addEventListener('keyup', onKeyEvent)
          document.addEventListener('keypress', onKeyEvent)
        }
      },
    }),
    [onKeyEvent],
  )

  useEffect(() => {
    const parent = parentBoundary
    parent?.enterExclusiveMode()

    return () => parent?.exitExclusiveMode()
  }, [parentBoundary])

  return <KeyListenerContext.Provider value={value}>{children}</KeyListenerContext.Provider>
}
