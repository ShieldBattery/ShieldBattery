import React from 'react'
import PropTypes from 'prop-types'

import ActivityButton from './activity-button'
import KeyListener from '../keyboard/key-listener'

class HotkeyedActivityButton extends React.Component {
  static propTypes = {
    buttonRef: PropTypes.object,
    disabled: PropTypes.bool,
    keycode: PropTypes.number.isRequired,
    altKey: PropTypes.bool,
    shiftKey: PropTypes.bool,
    ctrlKey: PropTypes.bool,
    label: PropTypes.string.isRequired,
    icon: PropTypes.element.isRequired,
    onClick: PropTypes.func,
  }

  static defaultProps = {
    disabled: false,
    altKey: false,
    shiftKey: false,
    ctrlKey: false,
  }

  render() {
    const { buttonRef, disabled, label, icon, count, glowing, onClick } = this.props
    const activityButtonProps = {
      ref: buttonRef,
      label,
      icon,
      disabled,
      count,
      glowing,
      onClick,
    }

    return (
      <>
        <KeyListener onKeyDown={this.onKeyDown} />
        <ActivityButton {...activityButtonProps} />
      </>
    )
  }

  onKeyDown = event => {
    const { disabled, keycode, altKey, shiftKey, ctrlKey, onClick } = this.props

    if (
      !disabled &&
      onClick &&
      event.keyCode === keycode &&
      event.altKey === altKey &&
      event.shiftKey === shiftKey &&
      event.ctrlKey === ctrlKey
    ) {
      onClick()
      return true
    }

    return false
  }
}

export default React.forwardRef((props, ref) => (
  <HotkeyedActivityButton buttonRef={ref} {...props} />
))
