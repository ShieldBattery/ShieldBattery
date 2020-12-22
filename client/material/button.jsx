import React from 'react'
import PropTypes from 'prop-types'
import styled from 'styled-components'

import { reset } from './button-reset'
import { fastOutSlowInShort } from './curves'
import { colorTextPrimary, colorTextFaint } from '../styles/colors'
import { buttonText } from '../styles/typography'

export const ButtonCommon = styled.button`
  ${reset};
  display: inline-table;
  min-height: 36px;
  border-radius: 4px;
  text-align: center;
  ${fastOutSlowInShort};

  ${props => {
    if (props.disabled) return ''

    return `
      &:hover {
        background-color: rgba(255, 255, 255, 0.08);
      }
      ${props.focused ? 'background-color: rgba(255, 255, 255, 0.08)' : ''};
    `
  }}
`

export const ButtonContent = styled(ButtonCommon)`
  min-width: 88px;
  margin: 6px 0;
  padding: 0 16px;
`

export const Label = styled.span`
  ${buttonText};
  display: flex;
  justify-content: center;
  align-items: center;
  color: ${props => (props.disabled ? colorTextFaint : colorTextPrimary)};
  line-height: 36px;
  white-space: nowrap;
`

// Button with Material Design goodness. You don't want to use this directly, see FlatButton or
// RaisedButton instead
export default class Button extends React.Component {
  static propTypes = {
    label: PropTypes.oneOfType([PropTypes.string, PropTypes.element]).isRequired,
    contentComponent: PropTypes.elementType,
    onBlur: PropTypes.func,
    onFocus: PropTypes.func,
    onClick: PropTypes.func,
    onMouseDown: PropTypes.func,
    buttonRef: PropTypes.oneOfType([PropTypes.func, PropTypes.object]),
  }

  state = {
    isKeyboardFocused: false,
  }

  mouseActive = false
  clearMouseActive = null
  _ref = React.createRef()
  _setRef = elem => {
    this._ref.current = elem

    if (this.props.buttonRef) {
      if (typeof this.props.buttonRef === 'function') {
        this.props.buttonRef(elem)
      } else {
        this.props.buttonRef.current = elem
      }
    }
  }

  render() {
    const {
      label,
      buttonRef, // eslint-disable-line @typescript-eslint/no-unused-vars
      ...otherProps
    } = this.props

    const buttonProps = {
      onBlur: e => this._handleBlur(e),
      onFocus: e => this._handleFocus(e),
      onClick: e => this._handleClick(e),
      onMouseDown: e => this._handleMouseDown(e),
    }

    const Component = this.props.contentComponent || ButtonCommon
    return (
      <Component
        ref={this._setRef}
        disabled={this.props.disabled}
        focused={this.state.isKeyboardFocused}
        {...otherProps}
        {...buttonProps}>
        <Label disabled={this.props.disabled}>{label}</Label>
      </Component>
    )
  }

  focus() {
    this._ref.current.focus()
  }

  blur() {
    this._ref.current.blur()
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
