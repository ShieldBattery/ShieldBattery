import React from 'react'
import PropTypes from 'prop-types'
import uniqueId from '../dom/unique-id'
import styled, { css } from 'styled-components'

import FloatingLabel from './input-floating-label.jsx'
import InputError from './input-error.jsx'
import InputUnderline from './input-underline.jsx'
import Label from './input-label.jsx'

import { colorTextPrimary, colorTextFaint } from '../styles/colors'

const InputContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  position: relative;
  width: 100%;
  height: 56px;
  padding: 0;
  font-size: 16px;
  line-height: 24px;
  background-color: rgba(255, 255, 255, 0.1);
  border-radius: 4px 4px 0 0;
  contain: layout paint style;

  ${props =>
    !props.disabled
      ? `
        &:hover {
          background-color: rgba(255, 255, 255, 0.12);
        }
      `
      : ''}

  ${props =>
    props.focused
      ? `
        background-color: rgba(255, 255, 255, 0.24) !important;
      `
      : ''}

  & input[type='text'],
  & input[type='password'],
  & input[type='datetime'],
  & input[type='datetime-local'],
  & input[type='date'],
  & input[type='month'],
  & input[type='time'],
  & input[type='week'],
  & input[type='number'],
  & input[type='email'],
  & input[type='url'],
  & input[type='search'],
  & input[type='tel'],
  & input[type='color'] {
    -moz-appearance: none;
    -webkit-appearance: none;
  }
`

const StyledInput = styled.input`
  flex-grow: 1;
  order: 2;
  display: block;
  width: 100%;
  height: 100%;
  padding: ${props => (props.floatingLabel ? '20px 12px 6px' : '12px')};
  border: none;
  border-radius: 0;
  outline: none;
  background: none;
  color: ${props => (props.disabled ? colorTextFaint : colorTextPrimary)};
  line-height: inherit;
  -ms-flex-preferred-size: inherit;

  &:focus {
    outline: none;
  }

  &:invalid {
    outline: none;
    box-shadow: none;
  }

  ${props => (props.leadingIcon ? 'padding-left: 48px' : '')};
  ${props => (props.trailingIcon ? 'padding-right: 48px' : '')};
`

const iconStyle = css`
  position: absolute;
  top: 50%;
  transform: translate3d(0, -50%, 0);
  width: 24px;
  height: 24px;
  pointer-events: none;

  & > svg {
    width: 24px;
    height: 24px;
    color: ${colorTextFaint};
  }
`

const LeadingIcon = styled.span`
  ${iconStyle}
  left: 12px;
`

const TrailingIcon = styled.span`
  ${iconStyle}
  right: 12px;
`

// A single-line Material text field, supporting with and without floating labels
export default class TextField extends React.Component {
  static propTypes = {
    value: PropTypes.string,
    name: PropTypes.string,
    type: PropTypes.string,
    allowErrors: PropTypes.bool,
    errorText: PropTypes.string,
    floatingLabel: PropTypes.bool,
    label: PropTypes.string,
    disabled: PropTypes.bool,
    leadingIcon: PropTypes.element,
    trailingIcon: PropTypes.element,
    onBlur: PropTypes.func,
    onChange: PropTypes.func,
    onFocus: PropTypes.func,
    onKeyDown: PropTypes.func,
    onEnterKeyDown: PropTypes.func,
    inputProps: PropTypes.object,
  }

  static defaultProps = {
    type: 'text',
    allowErrors: true,
    floatingLabel: false,
    disabled: false,
  }

  id = uniqueId()
  state = {
    isFocused: false,
  }
  input = null
  setInput = elem => {
    this.input = elem
  }

  render() {
    const {
      allowErrors,
      errorText,
      value,
      name,
      type,
      disabled,
      floatingLabel,
      leadingIcon,
      trailingIcon,
      inputProps,
    } = this.props

    const internalInputProps = {
      ref: this.setInput,
      id: this.id,
      value,
      type,
      name,
      disabled,
      onBlur: this.onInputBlur,
      onChange: this.onInputChange,
      onFocus: this.onInputFocus,
      onKeyDown: this.onKeyDown,
    }

    return (
      <div className={this.props.className}>
        <InputContainer disabled={disabled} focused={this.state.isFocused}>
          {this.renderLabel()}
          {leadingIcon ? <LeadingIcon>{leadingIcon}</LeadingIcon> : null}
          <StyledInput
            floatingLabel={!!floatingLabel}
            leadingIcon={!!leadingIcon}
            trailingIcon={!!trailingIcon}
            {...inputProps}
            {...internalInputProps}
          />
          {trailingIcon ? <TrailingIcon>{trailingIcon}</TrailingIcon> : null}
          <InputUnderline focused={this.state.isFocused} error={!!errorText} disabled={disabled} />
        </InputContainer>
        {allowErrors ? <InputError error={errorText} /> : null}
      </div>
    )
  }

  renderLabel() {
    const { label, floatingLabel, value, errorText, disabled, leadingIcon } = this.props
    const { isFocused } = this.state

    if (!label) {
      return null
    } else if (floatingLabel) {
      return (
        <FloatingLabel
          htmlFor={this.id}
          hasValue={!!value}
          focused={isFocused}
          error={!!errorText}
          disabled={disabled}
          leadingIcon={!!leadingIcon}>
          {label}
        </FloatingLabel>
      )
    } else {
      return (
        <Label htmlFor={this.id} hasValue={!!value} disabled={disabled} leadingIcon={!!leadingIcon}>
          {label}
        </Label>
      )
    }
  }

  blur() {
    this.input.blur()
  }

  focus() {
    this.input.focus()
  }

  onInputBlur = e => {
    this.setState({ isFocused: false })
    if (this.props.onBlur) {
      this.props.onBlur(e)
    }
  }

  onInputFocus = e => {
    this.setState({ isFocused: true })
    if (this.props.onFocus) {
      this.props.onFocus(e)
    }
  }

  onInputChange = e => {
    if (this.props.onChange) {
      this.props.onChange(e)
    }
  }

  onKeyDown = e => {
    if (e.keyCode === 13 && this.props.onEnterKeyDown) {
      this.props.onEnterKeyDown(e)
    }
    if (this.props.onKeyDown) {
      this.props.onKeyDown(e)
    }
  }
}
