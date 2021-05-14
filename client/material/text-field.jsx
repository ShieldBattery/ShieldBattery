import PropTypes from 'prop-types'
import React from 'react'
import styled, { css } from 'styled-components'
import uniqueId from '../dom/unique-id'
import { colorTextSecondary } from '../styles/colors'
import InputBase, { TEXTAREA_BOTTOM_PADDING, TEXTAREA_BOTTOM_PADDING_DENSE } from './input-base'
import InputError from './input-error'
import FloatingLabel from './input-floating-label'
import Label from './input-label'
import InputUnderline from './input-underline'

// NOTE(2Pac): You might notice that this component (and others that are used here) might have some
// weird values used for paddings and margins, like 1px, or 7px. This is fine. It's mostly caused by
// the intrinsic weirdness of the <input> element itself and the way its implemented in the browser.
// Like, its vertical centering of the text might be off by 1 pixel than what it is for labels that
// we use flex to center with here. To ensure the pixel-perfect alignment of some elements, certain
// numbers had to be fudged a bit which was ascertained by using custom browser extensions to
// measure the distance in pixels.

const TextFieldContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  position: relative;
  width: 100%;
  min-height: ${props => (props.dense ? '40px' : '56px')};
  font-size: 16px;
  line-height: 20px;
  background-color: rgba(255, 255, 255, 0.1);
  border-radius: 4px 4px 0 0;
  contain: layout paint style;
  user-select: text;

  ${props => {
    const spacing = props.floatingLabel ? 34 : 28 /* textfield padding + input margin */
    const height = props.dense ? 40 : 56

    return `max-height: ${props.maxRows ? props.maxRows * 20 + spacing : height}px;`
  }}

  ${props => {
    if (!props.multiline) return ''

    if (props.floatingLabel) {
      return props.dense ? 'padding: 17px 0 2px 12px' : 'padding: 25px 0 2px 12px;'
    } else {
      return props.dense ? 'padding: 11px 0 2px 12px' : 'padding: 19px 0 2px 12px;'
    }
  }}

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
        background-color: rgba(255, 255, 255, 0.16) !important;
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

const iconStyle = css`
  position: absolute;
  top: 4px;
  width: ${props => (props.dense ? '32px' : '48px')};
  height: ${props => (props.dense ? '32px' : '48px')};
  display: flex;
  justify-content: center;
  align-items: center;
  color: ${colorTextSecondary};
`

const LeadingIcon = styled.span`
  ${iconStyle}
  left: ${props => {
    const iconWidth = props.dense ? 32 : 48
    const leftOffset = props.index * iconWidth + (props.index + 1) * 4

    return `${leftOffset}px`
  }};
`

const TrailingIcon = styled.span`
  ${iconStyle}
  right: ${props => {
    const iconWidth = props.dense ? 32 : 48
    const multilinePadding = props.multiline ? 12 : 0
    const rightOffset = props.index * iconWidth + (props.index + 1) * 4 + multilinePadding

    return `${rightOffset}px`
  }};
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
    dense: PropTypes.bool,
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
    leadingIcons: PropTypes.arrayOf(PropTypes.element),
    trailingIcons: PropTypes.arrayOf(PropTypes.element),
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
    dense: false,
    disabled: false,
    multiline: false,
    rows: 1,
    leadingIcons: [],
    trailingIcons: [],
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
      dense,
      multiline,
      rows,
      maxRows,
      leadingIcons,
      trailingIcons,
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

    const leadingIconsElements = leadingIcons.map((leadingIcon, index) => {
      const elem = React.cloneElement(leadingIcon, { tabIndex: -1 })
      return (
        <LeadingIcon key={index} index={index} dense={dense}>
          {elem}
        </LeadingIcon>
      )
    })
    const trailingIconsElements = trailingIcons
      .slice() // Don't mutate the original array
      .reverse()
      .map((trailingIcon, index) => {
        const elem = React.cloneElement(trailingIcon, { tabIndex: -1 })
        return (
          <TrailingIcon key={index} index={index} dense={dense} multiline={multiline}>
            {elem}
          </TrailingIcon>
        )
      })

    return (
      <div className={this.props.className}>
        <TextFieldContainer
          disabled={disabled}
          focused={this.state.isFocused}
          floatingLabel={floatingLabel}
          dense={dense}
          multiline={multiline}
          maxRows={maxRows}>
          {this.renderLabel()}
          {leadingIcons.length > 0 ? leadingIconsElements : null}
          <InputBase
            as={multiline ? 'textarea' : 'input'}
            rows={rows}
            focused={this.state.isFocused}
            floatingLabel={floatingLabel}
            dense={dense}
            multiline={multiline}
            leadingIconsLength={leadingIcons.length}
            trailingIconsLength={trailingIcons.length}
            {...inputProps}
            {...internalInputProps}
          />
          {trailingIcons.length > 0 ? trailingIconsElements : null}
          <InputUnderline focused={this.state.isFocused} error={!!errorText} disabled={disabled} />
        </TextFieldContainer>
        {allowErrors ? <InputError error={errorText} /> : null}
      </div>
    )
  }

  renderLabel() {
    const { label, floatingLabel, dense, value, errorText, disabled, leadingIcons } = this.props
    const { isFocused } = this.state

    if (!label) {
      return null
    } else if (floatingLabel) {
      return (
        <FloatingLabel
          htmlFor={this.id}
          hasValue={!!value}
          dense={dense}
          focused={isFocused}
          error={!!errorText}
          disabled={disabled}
          leadingIconsLength={leadingIcons.length}>
          {label}
        </FloatingLabel>
      )
    } else {
      return (
        <Label
          htmlFor={this.id}
          hasValue={!!value}
          dense={dense}
          disabled={disabled}
          leadingIconsLength={leadingIcons.length}>
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
    const padding = this.props.dense ? TEXTAREA_BOTTOM_PADDING_DENSE : TEXTAREA_BOTTOM_PADDING
    // Needed in order to lower the height when deleting text
    elem.style.height = `${this.props.rows * 20 + padding}px`
    elem.style.height = `${elem.scrollHeight}px`
    // Textarea doesn't scroll completely to the end when adding a new line, just to the baseline of
    // the added text it seems, so we scroll manually to the end here
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
