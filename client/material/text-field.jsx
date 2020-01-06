import React from 'react'
import PropTypes from 'prop-types'
import uniqueId from '../dom/unique-id'
import styled, { css } from 'styled-components'

import FloatingLabel from './input-floating-label.jsx'
import InputBase from './input-base.jsx'
import InputError from './input-error.jsx'
import InputUnderline from './input-underline.jsx'
import Label from './input-label.jsx'

import { colorTextFaint, grey700, grey800, grey900 } from '../styles/colors'
import { singleLine } from '../styles/typography'

const TextFieldContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  position: relative;
  width: 100%;
  min-height: 56px;
  max-height: ${props => (props.maxRows ? props.maxRows * 24 + 32 /* padding */ : 56)}px;
  font-size: 16px;
  line-height: 24px;
  background-color: rgba(255, 255, 255, 0.1);
  border-radius: 4px 4px 0 0;
  contain: layout paint style;

  ${props =>
    props.multiline
      ? `
        padding: ${props.floatingLabel ? '23px 0 2px 12px' : '16px 0 2px 12px'};
      `
      : ''}

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
  & input[type='color'],
  & textarea {
    -moz-appearance: none;
    -webkit-appearance: none;
  }
`

const StyledInputContainer = styled(InputBase)`
  ${props => {
    if (props.multiline) {
      const scrollbarColor = props.focused ? grey800 : grey700

      return `
        padding: 0;
        padding-bottom: 7px;
        padding-right: 12px;
        overflow-y: auto;
        resize: none;
        cursor: auto;

        &::-webkit-scrollbar {
          width: 12px;
        }

        &::-webkit-scrollbar-track {
          background-color: ${scrollbarColor};
        }

        &::-webkit-scrollbar-thumb {
          width: 100%;
          border-left: 2px solid ${scrollbarColor};
          border-right: 2px solid ${scrollbarColor};
          margin-left: auto;
          margin-right: auto;
          background-color: ${grey900};
        }

        ::-webkit-scrollbar-button:start:decrement,
        ::-webkit-scrollbar-button:end:increment {
          height: 2px;
          background-color: ${scrollbarColor};
        }
      `
    } else {
      return `
        height: 24px;
        ${singleLine};
      `
    }
  }}
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

// A Material text field component with single-line, multi-line and text area variants, supporting
// with and without floating labels
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
    multiline: PropTypes.bool,
    rows: PropTypes.number,
    maxRows: props => {
      if (props.maxRows === undefined) {
        return null
      }
      if (typeof props.maxRows !== 'number') {
        return new Error('`maxRows` must be a number.')
      }
      if (props.maxRows < props.rows) {
        return new Error('The `maxRows` value needs to be higher or equal to the `rows` property.')
      }
      return null
    },
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
    multiline: false,
    rows: 1,
    maxRows: 4,
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
      multiline,
      rows,
      maxRows,
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
        <TextFieldContainer
          disabled={disabled}
          focused={this.state.isFocused}
          floatingLabel={!!floatingLabel}
          multiline={multiline}
          maxRows={maxRows}>
          {this.renderLabel()}
          {leadingIcon ? <LeadingIcon>{leadingIcon}</LeadingIcon> : null}
          <StyledInputContainer
            as={multiline ? 'textarea' : 'input'}
            rows={rows}
            focused={this.state.isFocused}
            floatingLabel={!!floatingLabel}
            multiline={multiline}
            leadingIcon={!!leadingIcon}
            trailingIcon={!!trailingIcon}
            {...inputProps}
            {...internalInputProps}
          />
          {trailingIcon ? <TrailingIcon>{trailingIcon}</TrailingIcon> : null}
          <InputUnderline focused={this.state.isFocused} error={!!errorText} disabled={disabled} />
        </TextFieldContainer>
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

  autoSize = elem => {
    // Needed in order to lower the height when deleting text
    elem.style.height = `${this.props.rows * 24 + 7 /* padding */}px`
    elem.style.height = `${elem.scrollHeight}px`
    // Textarea doesn't scroll completely to the end when adding a new line, just to the baseline of
    // the added text it seems, so we scroll automatically to the end here
    elem.scrollTop = elem.scrollHeight
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
    if (this.props.multiline) {
      this.autoSize(e.target)
    }
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
