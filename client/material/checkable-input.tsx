import { rgba } from 'polished'
import React from 'react'
import styled from 'styled-components'
import uniqueId from '../dom/unique-id'
import {
  alphaDisabled,
  alphaDividers,
  amberA400,
  colorBackground,
  colorDividers,
  colorTextFaint,
  colorTextPrimary,
  colorTextSecondary,
} from '../styles/colors'
import { fastOutSlowIn } from './curve-constants'

interface ChekableInputProps {
  type?: 'radio' | 'checkbox'
  name?: string
  checked?: boolean
  label?: React.ReactNode
  value?: string
  onChange?: (e: any) => void
  disabled?: boolean
  className?: string
  inputProps?: Record<string, any>
}

class CheckableInput extends React.Component<ChekableInputProps> {
  static defaultProps = {
    type: 'checkbox',
  }

  override readonly state = {
    isKeyboardFocused: false,
  }
  id = uniqueId()
  mouseActive = false
  clearMouseActive = -1

  override render() {
    const { type, className, label, checked, name, value, onChange, disabled, inputProps } =
      this.props
    const focused = this.state.isKeyboardFocused
    const labelElem = label ? <label htmlFor={this.id}>{this.props.label}</label> : null

    const internalInputProps = {
      type,
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
      <Root className={className} checked={checked} focused={focused} disabled={disabled}>
        {inputElem}
        <IconContainer checked={checked} focused={focused} disabled={disabled} type={type}>
          <CheckIcon checked={checked} focused={focused} disabled={disabled} type={type} />
        </IconContainer>
        {labelElem}
      </Root>
    )
  }

  onBlur = () => {
    if (this.state.isKeyboardFocused) {
      this.setState({ isKeyboardFocused: false })
    }
  }

  onFocus = () => {
    if (!this.mouseActive) {
      this.setState({ isKeyboardFocused: true })
    }
  }

  onMouseDown = () => {
    if (this.clearMouseActive) {
      clearTimeout(this.clearMouseActive)
    }
    this.clearMouseActive = window.setTimeout(() => {
      this.mouseActive = false
      this.clearMouseActive = -1
    }, 100)
    this.mouseActive = true
  }
}

interface CheckableControlProps {
  type?: string
  focused?: boolean
  disabled?: boolean
  checked?: boolean
}

const BOX_WIDTH = 18
const BOX_HEIGHT = 18

const Root = styled.div<CheckableControlProps>`
  position: relative;
  height: auto;
  min-width: ${BOX_WIDTH}px;
  min-height: ${BOX_HEIGHT + 2}px;
  padding: 8px 0 8px 2px;

  display: flex;
  align-items: center;

  contain: layout style;
  line-height: ${BOX_HEIGHT + 2}px;
  overflow: visible;

  input {
    position: absolute;
    left: 0;
    top: 0;
    width: 100%;
    height: 100%;

    padding: 0;
    margin: 0;
    outline: 0;
    opacity: 0;

    cursor: pointer;
  }

  label {
    order: 2;
    margin-left: 10px; /* the box is 18px wide, so this hits a 4px multiple */
    line-height: 20px;
    pointer-events: none;
    ${props => (props.disabled ? `color: ${colorTextFaint};` : '')}
  }
`

const IconContainer = styled.div<CheckableControlProps>`
  position: relative;
  order: 1;
  width: ${BOX_WIDTH}px;
  height: ${BOX_HEIGHT}px;
  pointer-events: none;
  background-color: ${props => {
    if (props.focused && !props.disabled && !props.checked) return colorDividers
    else return 'transparent'
  }};
  flex-shrink: 0;

  &::before {
    position: absolute;
    top: ${props => (props.focused && !props.disabled ? '-8px' : '0')};
    left: ${props => (props.focused && !props.disabled ? '-8px' : '0')};
    bottom: ${props => (props.focused && !props.disabled ? '-8px' : '0')};
    right: ${props => (props.focused && !props.disabled ? '-8px' : '0')};
    display: block;

    background-color: ${props => {
      if (props.disabled) return colorDividers
      else if (props.checked && props.focused) return rgba(amberA400, Number(alphaDividers))
      else return 'transparent'
    }};
    border-radius: 50%;
    content: '';
    transition: all 200ms ${fastOutSlowIn}, background-color 150ms linear;
  }

  &::after {
    position: absolute;
    top: -8px;
    left: -8px;
    bottom: -8px;
    right: -8px;
    border: none;
    content: '';
  }
`

const CheckIcon = styled.div<CheckableControlProps>`
  position: absolute;
  top: 0;
  left: 0;
  width: ${BOX_WIDTH}px;
  height: ${BOX_HEIGHT}px;
  border: 2px solid;
  border-radius: ${({ type }) => (type === 'checkbox' ? '2px' : '50%')};
  transition: border-color 200ms linear, background-color 200ms linear, opacity 150ms linear;

  background-color: ${props => {
    if (props.checked && props.disabled) return colorTextPrimary
    else if (props.checked) return amberA400
    else return 'transparent'
  }};
  border-color: ${props => {
    if (props.disabled) return colorTextPrimary
    else if (props.checked) return amberA400
    else return colorTextSecondary
  }};
  opacity: ${props => {
    if (props.disabled) return alphaDisabled
    else return '1'
  }};

  /*
    NOTE(tec27): This is a dumb hack that I learned from Angular Material. It renders a check mark
    by rendering a table element with no content but a transparent border on its bottom and right
    edge, and sizing the table such that its appropriate for our box size. This element can then be
    rotated in and will look correct.
  */
  &::after {
    position: absolute;
    left: ${BOX_WIDTH / 3 - 2}px;
    top: ${BOX_HEIGHT / 9 - 2}px;
    width: ${BOX_WIDTH / 3}px;
    height: ${(BOX_WIDTH * 2) / 3}px;
    display: table;

    border: 2px solid;
    border-color: ${props => (props.checked ? colorBackground : 'transparent')};
    border-top: 0;
    border-left: 0;
    content: '';
    transform: ${props => (props.checked ? 'rotate(45deg)' : 'rotate(-135deg)')};
    transition: border-color 150ms linear, transform 200ms ${fastOutSlowIn};
  }
`

// TODO(T1mL3arn) replace initial Checkbox (from `client/material/check-box.jsx`) with this one ?
export function Checkbox(props: Record<string, any>) {
  return <CheckableInput {...props} type='checkbox' />
}

export function Radio(props: Record<string, any>) {
  return <CheckableInput {...props} type='radio' />
}
