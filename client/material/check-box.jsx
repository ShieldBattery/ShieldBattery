import React from 'react'
import PropTypes from 'prop-types'
import classnames from 'classnames'
import uniqueId from '../dom/unique-id'
import styles from './check-box.css'

export default class CheckBox extends React.Component {
  static propTypes = {
    name: PropTypes.string,
    checked: PropTypes.bool,
    label: PropTypes.string,
    value: PropTypes.string,
    onChange: PropTypes.func,
    disabled: PropTypes.bool,
    className: PropTypes.oneOfType([PropTypes.string, PropTypes.array, PropTypes.object]),
  }

  id = uniqueId()
  state = {
    isKeyboardFocused: false,
  }
  mouseActive = false
  clearMouseActive = null

  render() {
    const { className, label, checked, name, value, onChange, disabled, inputProps } = this.props
    const classes = classnames(styles.checkBox, className, {
      [styles.checked]: checked,
      [styles.disabled]: disabled,
      [styles.focused]: this.state.isKeyboardFocused,
    })

    const labelElem = label
      ? <label htmlFor={this.id}>
          {this.props.label}
        </label>
      : null
    const iconElem = <div className={styles.icon} />

    const internalInputProps = {
      type: 'checkbox',
      id: this.id,
      checked,
      name,
      value,
      disabled,
      onBlur: this.onBlur,
      onFocus: this.onFocus,
      onChange,
      onMouseDown: this.onMouseDown,
    }
    const inputElem = <input {...inputProps} {...internalInputProps} />

    return (
      <div className={classes}>
        {inputElem}
        <div className={styles.iconContainer}>
          {iconElem}
        </div>
        {labelElem}
      </div>
    )
  }

  onBlur = e => {
    if (this.state.isKeyboardFocused) {
      this.setState({ isKeyboardFocused: false })
    }
  }

  onFocus = e => {
    if (!this.mouseActive) {
      this.setState({ isKeyboardFocused: true })
    }
  }

  onMouseDown = e => {
    if (this.clearMouseActive) {
      clearTimeout(this.clearMouseActive)
    }
    this.clearMouseActive = setTimeout(() => {
      this.mouseActive = false
      this.clearMouseActive = null
    }, 100)
    this.mouseActive = true
  }
}
