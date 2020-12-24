import React from 'react'
import PropTypes from 'prop-types'
import uniqueId from '../dom/unique-id'
import styled from 'styled-components'
import { rgba } from 'polished'
import {
  colorDividers,
  amberA400,
  alphaDividers,
  colorTextSecondary,
  colorTextFaint,
  colorTextPrimary,
  alphaDisabled,
  colorBackground,
} from '../styles/colors'
import { fastOutSlowIn } from './curve-constants'

const BOX_WIDTH = 18
const BOX_HEIGHT = 18

const Root = styled.div`
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
    /* for some reason, the combination of 1px padding and 19px line-height, centers the text a bit
    better vertically than simply using the line-height of 20px ¯\_(ツ)_/¯ */
    padding-top: 1px;
    line-height: 19px;
    pointer-events: none;
    ${props => (props.disabled ? `color: ${colorTextFaint};` : '')}
  }
`

const IconContainer = styled.div`
  position: relative;
  order: 1;
  width: ${BOX_WIDTH}px;
  height: ${BOX_HEIGHT}px;
  pointer-events: none;
  background-color: ${props => {
    if (props.focused && !props.disabled && !props.checked) return colorDividers
    else return 'transparent'
  }};

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

const CheckIcon = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  width: ${BOX_WIDTH}px;
  height: ${BOX_HEIGHT}px;
  border: 2px solid;
  border-radius: 2px;
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

export default class CheckBox extends React.Component {
  static propTypes = {
    name: PropTypes.string,
    checked: PropTypes.bool,
    label: PropTypes.string,
    value: PropTypes.string,
    onChange: PropTypes.func,
    disabled: PropTypes.bool,
    className: PropTypes.string,
  }

  id = uniqueId()
  state = {
    isKeyboardFocused: false,
  }
  mouseActive = false
  clearMouseActive = null

  render() {
    const { className, label, checked, name, value, onChange, disabled, inputProps } = this.props
    const focused = this.state.isKeyboardFocused

    const labelElem = label ? <label htmlFor={this.id}>{this.props.label}</label> : null

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
      <Root className={className} checked={checked} focused={focused} disabled={disabled}>
        {inputElem}
        <IconContainer checked={checked} focused={focused} disabled={disabled}>
          <CheckIcon checked={checked} focused={focused} disabled={disabled} />
        </IconContainer>
        {labelElem}
      </Root>
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
