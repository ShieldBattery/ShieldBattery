import React from 'react'
import PropTypes from 'prop-types'

// An animation-frame throttled event listener attached to the window, useful for things like
// listening to resize events and adjusting state based on it (e.g. fixed position). Note that this
// component assumes that its event and listener props will not change over its lifetime, and
// ignores any changes to them.
export default class WindowListener extends React.Component {
  static propTypes = {
    event: PropTypes.string.isRequired,
    listener: PropTypes.func.isRequired,
  }

  constructor(props, context) {
    super(props, context)
    this.rafId = null
    this.eventHandler = this.onEvent.bind(this)
    this.frameHandler = this.onFrame.bind(this)
    this.lastEvent = null
  }

  componentDidMount() {
    window.addEventListener(this.props.event, this.eventHandler)
  }

  componentWillUnmount() {
    window.removeEventListener(this.props.event, this.eventHandler)
    if (this.rafId) {
      window.cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }

  render() {
    return null
  }

  onEvent(event) {
    this.lastEvent = event
    if (!this.rafId) {
      this.rafId = window.requestAnimationFrame(this.frameHandler)
    }
  }

  onFrame() {
    this.rafId = null
    this.props.listener(this.lastEvent)
    this.lastEvent = null
  }
}
