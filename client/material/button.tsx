import PropTypes from 'prop-types'
import React, { MutableRefObject } from 'react'
import styled from 'styled-components'
import { colorTextFaint, colorTextPrimary } from '../styles/colors'
import { buttonText } from '../styles/typography'
import { reset } from './button-reset'
import { fastOutSlowInShort } from './curves'

export interface ButtonCommonProps {
  disabled?: boolean
  focused?: boolean
}

export const ButtonCommon = styled.button<ButtonCommonProps>`
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

export interface ButtonLabelProps {
  disabled?: boolean
}

export const Label = styled.span<ButtonLabelProps>`
  ${buttonText};
  display: flex;
  justify-content: center;
  align-items: center;
  color: ${props => (props.disabled ? colorTextFaint : colorTextPrimary)};
  line-height: 36px;
  white-space: nowrap;
`

export interface ButtonProps {
  label: string | React.ReactNode
  disabled?: boolean
  contentComponent?: React.ComponentType
  onBlur?: React.FocusEventHandler
  onFocus?: React.FocusEventHandler
  onClick?: React.MouseEventHandler
  onMouseDown?: React.MouseEventHandler
  buttonRef?: React.Ref<HTMLButtonElement>
  // TODO(tec27): Probably this should come from the content component type?
  tabIndex?: number
  title?: string
}

interface ButtonState {
  isKeyboardFocused: boolean
}

// Button with Material Design goodness. You don't want to use this directly, see FlatButton or
// RaisedButton instead
export default class Button extends React.Component<ButtonProps, ButtonState> {
  static propTypes = {
    label: PropTypes.oneOfType([PropTypes.string, PropTypes.element]).isRequired,
    contentComponent: PropTypes.elementType,
    onBlur: PropTypes.func,
    onFocus: PropTypes.func,
    onClick: PropTypes.func,
    onMouseDown: PropTypes.func,
    buttonRef: PropTypes.oneOfType([PropTypes.func, PropTypes.object]),
  }

  state: ButtonState = {
    isKeyboardFocused: false,
  }

  protected mouseActive = false
  protected clearMouseActive: ReturnType<typeof setTimeout> | null = null
  // TODO(tec27): Type this better
  private ref: MutableRefObject<HTMLButtonElement | null> = React.createRef()
  private setRef = (elem: HTMLButtonElement | null) => {
    this.ref.current = elem

    if (this.props.buttonRef) {
      if (typeof this.props.buttonRef === 'function') {
        this.props.buttonRef(elem)
      } else {
        ;(this.props.buttonRef as MutableRefObject<HTMLButtonElement | null>).current = elem
      }
    }
  }

  render() {
    const {
      label,
      buttonRef, // eslint-disable-line @typescript-eslint/no-unused-vars
      ...otherProps
    } = this.props

    const Component = this.props.contentComponent || ButtonCommon
    return (
      <Component
        ref={this.setRef}
        disabled={this.props.disabled}
        focused={this.state.isKeyboardFocused}
        {...otherProps}
        onBlur={this.handleBlur}
        onFocus={this.handleFocus}
        onClick={this.handleClick}
        onMouseDown={this.handleMouseDown}>
        <Label disabled={this.props.disabled}>{label}</Label>
      </Component>
    )
  }

  focus() {
    this.ref.current?.focus()
  }

  blur() {
    this.ref.current?.blur()
  }

  private handleBlur = (e: React.FocusEvent) => {
    if (this.state.isKeyboardFocused) {
      this.setState({ isKeyboardFocused: false })
    }

    if (this.props.onBlur) {
      this.props.onBlur(e)
    }
  }

  private handleFocus = (e: React.FocusEvent) => {
    if (!this.mouseActive) {
      this.setState({ isKeyboardFocused: true })
    }

    if (this.props.onFocus) {
      this.props.onFocus(e)
    }
  }

  private handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    if (!this.props.disabled && this.props.onClick) {
      this.props.onClick(e)
    }
  }

  private handleMouseDown = (e: React.MouseEvent) => {
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
