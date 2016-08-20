import React, { PropTypes } from 'react'

const mounted = []

function onKeyDown(event) {
  if (event.defaultPrevented) return

  for (let i = mounted.length - 1; i >= 0; i--) {
    if (mounted[i]._handleKeyDown(event)) break
  }
}

function onKeyUp(event) {
  if (event.defaultPrevented) return

  for (let i = mounted.length - 1; i >= 0; i--) {
    if (mounted[i]._handleKeyUp(event)) break
  }
}

function onKeyPress(event) {
  if (event.defaultPrevented) return

  for (let i = mounted.length - 1; i >= 0; i--) {
    if (mounted[i]._handleKeyPress(event)) break
  }
}

// A component that allows for listening to keypresses in a distributed way, while still giving
// deeper/like more specific components handling precedence over their more general ancestors.
//
// All event handler props should return true if they've handled a particular event, and it
// shouldn't be handled further.
export default class KeyListener extends React.Component {
  static propTypes = {
    onKeyDown: PropTypes.func,
    onKeyUp: PropTypes.func,
    onKeyPress: PropTypes.func,
  };

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
      document.addEventListener('keydown', onKeyDown)
      document.addEventListener('keyup', onKeyUp)
      document.addEventListener('keypress', onKeyPress)
    }
    mounted.push(this)
  }

  componentWillUnmount() {
    mounted.splice(mounted.indexOf(this), 1)
    if (!mounted.length) {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keyup', onKeyUp)
      document.removeEventListener('keypress', onKeyPress)
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
      return <div>{ children }</div>
    }
  }
}
