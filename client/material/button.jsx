import React from 'react'
import classnames from 'classnames'
import styles from './button.css'

// Button with Material Design goodness. You don't want to use this directly, see FlatButton or
// RaisedButton instead
class Button extends React.Component {
  constructor(props) {
    super(props)
    this.state = {
      isKeyboardFocused: false
    }
    this.mouseActive = false
    this.clearMouseActive = null
  }
  _ref = null;
  _setRef = elem => {
    this._ref = elem
    if (this.props.buttonRef) {
      this.props.buttonRef(elem)
    }
  };

  render() {
    const {
      label,
      avatarClassName, // eslint-disable-line no-unused-vars
      buttonRef, // eslint-disable-line no-unused-vars
      ...otherProps,
    } = this.props

    const classes = classnames(this.props.className, {
      [styles.focused]: this.state.isKeyboardFocused,
    })

    const buttonProps = {
      className: classes,
      onBlur: e => this._handleBlur(e),
      onFocus: e => this._handleFocus(e),
      onClick: e => this._handleClick(e),
      onMouseDown: e => this._handleMouseDown(e),
    }

    return (<button ref={this._setRef} {...otherProps} {...buttonProps}>
      <span className={styles.label}>{label}</span>
    </button>)
  }

  isKeyboardFocused() {
    return this.state.isKeyboardFocused
  }

  focus() {
    this._ref.focus()
  }

  blur() {
    this._ref.blur()
  }

  _handleBlur(e) {
    if (this.state.isKeyboardFocused) {
      this.setState({ isKeyboardFocused: false })
    }

    if (this.props.onBlur) {
      this.props.onBlur(e)
    }
  }

  _handleFocus(e) {
    if (!this.mouseActive) {
      this.setState({ isKeyboardFocused: true })
    }

    if (this.props.onFocus) {
      this.props.onFocus(e)
    }
  }

  _handleClick(e) {
    e.preventDefault()
    if (!this.props.disabled && this.props.onClick) {
      this.props.onClick(e)
    }
  }

  _handleMouseDown(e) {
    if (this.clearMouseActive) {
      clearTimeout(this.clearMouseActive)
    }
    this.clearMouseActive = setTimeout(() => {
      this.mouseActive = false
      this.clearMouseActive = null
    }, 100)
    this.mouseActive = true

    if (this.props.onMouseDown) {
      this.props.onMouseDown(e)
    }
  }
}

Button.propTypes = {
  label: React.PropTypes.oneOfType([
    React.PropTypes.string,
    React.PropTypes.element,
  ]).isRequired,
  onBlur: React.PropTypes.func,
  onFocus: React.PropTypes.func,
  onClick: React.PropTypes.func,
  onMouseDown: React.PropTypes.func,
  buttonRef: React.PropTypes.func,
}

export default Button
