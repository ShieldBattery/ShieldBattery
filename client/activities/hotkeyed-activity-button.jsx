import React from 'react'
import PropTypes from 'prop-types'

import ActivityButton from './activity-button.jsx'
import KeyListener from '../keyboard/key-listener.jsx'

export default class HotkeyedActivityButton extends React.Component {
  static propTypes = {
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
    const { disabled, label, icon, onClick } = this.props
    const activityButtonProps = {
      label,
      icon,
      disabled,
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
