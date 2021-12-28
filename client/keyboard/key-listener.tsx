import React, { useEffect, useMemo } from 'react'
import { useValueAsRef } from '../state-hooks'

interface KeyHandler {
  isExclusive(): boolean
  keydown: (event: KeyboardEvent) => boolean
  keyup: (event: KeyboardEvent) => boolean
  keypress: (event: KeyboardEvent) => boolean
}

const mounted: Array<KeyHandler> = []

function onKeyEvent(event: KeyboardEvent) {
  if (event.defaultPrevented) return

  const handlerName = event.type
  if (handlerName !== 'keydown' && handlerName !== 'keyup' && handlerName !== 'keypress') {
    throw new Error('Unsupported event: ' + event.type)
  }

  // TODO(tec27): This implementation fails to handle two disparate exclusive trees of components
  // being mounted at once. A better solution would probably be to add a context into the tree when
  // exclusivity is needed, such that we could maintain separate lists for each tree. We don't
  // actually have a way that this occurs in the app for now though, so this work hasn't been done.
  let handled = false
  for (let i = mounted.length - 1; !handled && i >= 0; i--) {
    handled = mounted[i][handlerName](event)
    if (mounted[i].isExclusive()) {
      break
    }
  }

  if (handled) {
    event.preventDefault()
  }
}

function addKeyHandler(handler: KeyHandler) {
  if (!mounted.length) {
    document.addEventListener('keydown', onKeyEvent)
    document.addEventListener('keyup', onKeyEvent)
    document.addEventListener('keypress', onKeyEvent)
  }
  mounted.push(handler)
}

function removeKeyHandler(handler: KeyHandler) {
  mounted.splice(mounted.indexOf(handler), 1)
  if (!mounted.length) {
    document.removeEventListener('keydown', onKeyEvent)
    document.removeEventListener('keyup', onKeyEvent)
    document.removeEventListener('keypress', onKeyEvent)
  }
}

export interface KeyListenerProps {
  onKeyDown?: (event: KeyboardEvent) => boolean
  onKeyUp?: (event: KeyboardEvent) => boolean
  onKeyPress?: (event: KeyboardEvent) => boolean
  exclusive?: boolean
}

/**
 * A component that allows for listening to keypresses in a distributed way, while still giving
 * deeper/like more specific components handling precedence over their more general ancestors.
 *
 * If an `exclusive` prop is sent, the handlers will be executed only for this component and its
 * descendants. When used in this way, this component should not have children because of the way
 * React works, it's possible to end up in a situation where the child is mounted earlier than the
 * parent so the descendants are estimated by the order they registered this component. The
 * `exclusive` prop should be reserved for components that need to hijack key events, like dialogs
 * and overlays. A real example of this use case is an activity overlay and a map browser inside it.
 * Both of those components have `KeyListener` registered, but only activity overlay should have
 * `exclusive` prop set, because map browser component could be used from many different places.
 *
 * All event handler props should return true if they've handled a particular event, and it
 * shouldn't be handled further.
 */
export default class KeyListener extends React.Component<KeyListenerProps> {
  _keyHandler: KeyHandler = {
    isExclusive: () => Boolean(this.props.exclusive),
    keydown: event => Boolean(this.props.onKeyDown && this.props.onKeyDown(event)),
    keyup: event => Boolean(this.props.onKeyUp && this.props.onKeyUp(event)),
    keypress: event => Boolean(this.props.onKeyPress && this.props.onKeyPress(event)),
  }

  override componentDidMount() {
    addKeyHandler(this._keyHandler)
  }

  override componentWillUnmount() {
    removeKeyHandler(this._keyHandler)
  }

  override render() {
    const { children } = this.props
    const count = React.Children.count(children)
    if (!count) {
      return null
    } else if (count === 1) {
      return React.Children.only(children)
    } else {
      return <div>{children}</div>
    }
  }
}

export function useKeyListener(props: KeyListenerProps) {
  const exclusiveRef = useValueAsRef(props.exclusive)
  const keydownRef = useValueAsRef(props.onKeyDown)
  const keyupRef = useValueAsRef(props.onKeyUp)
  const keypressRef = useValueAsRef(props.onKeyPress)

  const handler = useMemo<KeyHandler>(() => {
    return {
      isExclusive: () => Boolean(exclusiveRef.current),
      keydown: event => Boolean(keydownRef.current && keydownRef.current(event)),
      keyup: event => Boolean(keyupRef.current && keyupRef.current(event)),
      keypress: event => Boolean(keypressRef.current && keypressRef.current(event)),
    }
  }, [exclusiveRef, keydownRef, keypressRef, keyupRef])

  useEffect(() => {
    addKeyHandler(handler)
    return () => removeKeyHandler(handler)
  }, [handler])
}
