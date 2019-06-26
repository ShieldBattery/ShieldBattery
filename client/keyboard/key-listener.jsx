import React from 'react'
import PropTypes from 'prop-types'

const mounted = []

function onKeyEvent(event) {
  if (event.defaultPrevented) return

  const exclusiveIndex = mounted.findIndex(m => m.isExclusive)
  const listeners = exclusiveIndex < 0 ? mounted : mounted.slice(exclusiveIndex)

  let handlerName
  switch (event.type) {
    case 'keydown':
      handlerName = '_handleKeyDown'
      break
    case 'keyup':
      handlerName = '_handleKeyUp'
      break
    case 'keypress':
      handlerName = '_handleKeyPress'
      break
    default:
      throw new Error('Unsupported event: ' + event.type)
  }

  let handled = false
  for (let i = listeners.length - 1; !handled && i >= 0; i--) {
    handled = listeners[i][handlerName](event)
  }

  if (handled) {
    event.preventDefault()
  }
}

// A component that allows for listening to keypresses in a distributed way, while still giving
// deeper/like more specific components handling precedence over their more general ancestors.
//
// If an `exclusive` prop is sent, the handlers will be executed only for this component and its
// descendants. When used in this way, this component should not have children because of the way
// React works, it's possible to end up in a situation where the child is mounted earlier than the
// parent so the descendants are estimated by the order they registered this component. The
// `exclusive` prop should be reserved for components that need to hijack key events, like dialogs
// and overlays. A real example of this use case is an activity overlay and a map browser inside it.
// Both of those components have `KeyListener` registered, but only activity overlay should have
// `exclusive` prop set, because map browser component could be used from many different places.
//
// All event handler props should return true if they've handled a particular event, and it
// shouldn't be handled further.
export default class KeyListener extends React.Component {
  static propTypes = {
    onKeyDown: PropTypes.func,
    onKeyUp: PropTypes.func,
    onKeyPress: PropTypes.func,
    exclusive: PropTypes.bool,
  }

  get isExclusive() {
    return this.props.exclusive
  }

  _handleKeyDown(event) {
    return this.props.onKeyDown && this.props.onKeyDown(event)
  }

  _handleKeyUp(event) {
    return this.props.onKeyUp && this.props.onKeyUp(event)
  }

  _handleKeyPress(event) {
    return this.props.onKeyPress && this.props.onKeyPress(event)
  }

  componentDidMount() {
    if (!mounted.length) {
      document.addEventListener('keydown', onKeyEvent)
      document.addEventListener('keyup', onKeyEvent)
      document.addEventListener('keypress', onKeyEvent)
    }
    mounted.push(this)
  }

  componentWillUnmount() {
    mounted.splice(mounted.indexOf(this), 1)
    if (!mounted.length) {
      document.removeEventListener('keydown', onKeyEvent)
      document.removeEventListener('keyup', onKeyEvent)
      document.removeEventListener('keypress', onKeyEvent)
    }
  }

  render() {
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
