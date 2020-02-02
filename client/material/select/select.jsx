import React from 'react'
import PropTypes from 'prop-types'
import { CSSTransition } from 'react-transition-group'
import styled from 'styled-components'

import FloatingLabel from '../input-floating-label.jsx'
import InputBase from '../input-base.jsx'
import InputError from '../input-error.jsx'
import InputUnderline from '../input-underline.jsx'
import KeyListener from '../../keyboard/key-listener.jsx'
import Menu, { Overlay } from '../menu/menu.jsx'

import ArrowDropDownIcon from '../../icons/material/ic_arrow_drop_down_black_24px.svg'

import { fastOutSlowIn, fastOutLinearIn, linearOutSlowIn } from '../curve-constants'
import { shadowDef8dp } from '../shadow-constants'
import { amberA400, colorTextFaint, colorTextPrimary } from '../../styles/colors'

const transitionNames = {
  appear: 'enter',
  appearActive: 'enterActive',
  enter: 'enter',
  enterActive: 'enterActive',
  exit: 'exit',
  exitActive: 'exitActive',
}

const SPACE = 'Space'
const ENTER = 'Enter'

const CONTAINER_HEIGHT = 56

const SelectContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  position: relative;
  width: 100%;
  height: ${CONTAINER_HEIGHT}px;
  padding: 0;
  cursor: ${props => (props.disabled ? 'default' : 'pointer')};
  font-size: 16px;
  line-height: 20px;
  background-color: rgba(255, 255, 255, 0.1);
  border-radius: 4px 4px 0 0;
  contain: layout paint style;

  &:focus {
    outline: none;
  }

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
`

const DisplayValue = styled(InputBase)`
  display: flex;
  align-items: center;
`

const Icon = styled.span`
  position: absolute;
  top: 50%;
  right: 12px;
  width: 24px;
  height: 24px;
  margin-left: 4px;
  pointer-events: none;
  transform: translate3d(0, -50%, 0) ${props => (props.open ? 'rotate(180deg)' : '')};
  transition: transform 150ms ${fastOutSlowIn};

  & > svg {
    width: 24px;
    height: 24px;
    ${props => {
      let color
      if (props.disabled) {
        color = colorTextFaint
      } else if (props.focused) {
        color = amberA400
      } else {
        color = colorTextPrimary
      }

      return `color: ${color}`
    }};
  }
`

const StyledOverlay = styled(Overlay)`
  width: ${props => props.overlayWidth}px;
  transform-origin: center top;

  &.enter {
    opacity: 0;
    transform: scale(0.95, 0.8);
    box-shadow: none;
  }

  &.enterActive {
    opacity: 1;
    box-shadow: ${shadowDef8dp};
    transform: scale(1, 1);
    transition: transform 120ms ${fastOutSlowIn}, opacity 30ms ${linearOutSlowIn},
      box-shadow 30ms ${linearOutSlowIn};
  }

  &.exit {
    pointer-events: none;
    opacity: 1;
    transform: scale(1, 1);
    box-shadow: ${shadowDef8dp};
  }

  &.exitActive {
    opacity: 0;
    transform: scale(0.95, 0.9);
    box-shadow: none;
    transition: transform 120ms ${fastOutSlowIn}, opacity 50ms ${fastOutLinearIn} 50ms,
      box-shadow 30ms ${fastOutLinearIn};
  }
`

class Select extends React.Component {
  static propTypes = {
    allowErrors: PropTypes.bool,
    errorText: PropTypes.string,
    label: PropTypes.string,
    value: PropTypes.any,
    onChange: PropTypes.func,
    // function used to compare values for equality, will never be called with null/undefined
    compareValues: PropTypes.func,
  }

  static defaultProps = {
    allowErrors: true,
    compareValues: (a, b) => a === b,
  }

  state = {
    isFocused: false,
    isOpened: false,
  }
  _root = React.createRef()

  hasValue() {
    return this.props.value !== undefined
  }

  render() {
    return (
      <div className={this.props.className}>
        <KeyListener onKeyDown={this.onKeyDown} />
        {this.renderSelect()}
        {this.renderOverlay()}
      </div>
    )
  }

  renderSelect() {
    const { allowErrors, errorText, label, disabled } = this.props

    let displayValue
    if (this.hasValue()) {
      React.Children.forEach(this.props.children, child => {
        if (this.props.value != null && child.props.value != null) {
          if (this.props.compareValues(this.props.value, child.props.value)) {
            displayValue = child.props.text
          }
        } else if (this.props.value === child.props.value) {
          // if both are undefined/null
          displayValue = child.props.text
        }
      })
    }

    return (
      <>
        <SelectContainer
          ref={this._root}
          disabled={disabled}
          focused={this.state.isFocused}
          tabIndex={disabled ? undefined : this.props.tabIndex || 0}
          onFocus={this.onFocus}
          onBlur={this.onBlur}
          onClick={this.onOpen}>
          {this.renderLabel()}
          <DisplayValue as='span' floatingLabel={!!label} disabled={disabled} trailingIcon={true}>
            {displayValue}
          </DisplayValue>
          <Icon open={this.state.isOpened} focused={this.state.isFocused} disabled={disabled}>
            <ArrowDropDownIcon />
          </Icon>
          <InputUnderline focused={this.state.isFocused} error={!!errorText} disabled={disabled} />
        </SelectContainer>
        {allowErrors ? <InputError error={errorText} /> : null}
      </>
    )
  }

  renderLabel() {
    if (!this.props.label) {
      return null
    }

    return (
      <FloatingLabel
        htmlFor={this.id}
        hasValue={this.hasValue()}
        focused={this.state.isFocused}
        disabled={this.props.disabled}
        error={!!this.props.errorText}>
        {this.props.label}
      </FloatingLabel>
    )
  }

  renderOverlay() {
    const valueIndex = this._getValueIndex()
    const options = React.Children.map(this.props.children, (child, i) => {
      return React.cloneElement(child, {
        selected: i === valueIndex,
        onOptionSelected: this.onOptionChanged,
      })
    })

    const popoverProps = {
      open: this.state.isOpened,
      onDismiss: this.onClose,
      anchor: this._root.current,
      anchorOriginVertical: 'top',
      anchorOriginHorizontal: 'left',
      anchorOffsetVertical: CONTAINER_HEIGHT,
      popoverOriginVertical: 'top',
      popoverOriginHorizontal: 'left',
      disableScaleTransition: true,
    }
    const overlayWidth = this._root.current && this._root.current.offsetWidth
    const menuProps = {
      selectedIndex: this.hasValue ? valueIndex : -1,
      onItemSelected: this.onOptionChanged,
      renderTransition: content => (
        <CSSTransition
          in={this.state.isOpened}
          classNames={transitionNames}
          appear={true}
          timeout={120}>
          <StyledOverlay key='menu' overlayWidth={overlayWidth}>
            {content}
          </StyledOverlay>
        </CSSTransition>
      ),
    }

    return (
      <Menu {...popoverProps} {...menuProps}>
        {options}
      </Menu>
    )
  }

  _getValueIndex() {
    let valueIndex = 0
    if (this.hasValue()) {
      React.Children.forEach(this.props.children, (child, i) => {
        if (this.props.value != null && child.props.value != null) {
          if (this.props.compareValues(this.props.value, child.props.value)) {
            valueIndex = i
          }
        } else if (this.props.value === child.props.value) {
          // if both are undefined/null
          valueIndex = i
        }
      })
    }
    return valueIndex
  }

  focus() {
    this._root.current.focus()
  }

  blur() {
    this._root.current.blur()
  }

  onKeyDown = event => {
    if (!this.state.isFocused) return false

    if (!this.state.isOpened) {
      if (event.code === SPACE || event.code === ENTER) {
        this.onOpen()
        return true
      }
    }

    return false
  }

  onOpen = () => {
    if (!this.props.disabled) {
      this.setState({ isOpened: true })
    }
  }

  onClose = () => {
    this.setState({ isOpened: false })
    this.focus()
  }

  onFocus = () => {
    if (!this.props.disabled) {
      this.setState({ isFocused: true })
    }
  }

  onBlur = () => {
    if (!this.state.isOpened) {
      // If we're opened, leave isFocused since we'll be reassigning focus on close
      this.setState({ isFocused: false })
    }
  }

  onOptionChanged = value => {
    if (this.props.onChange) {
      this.props.onChange(value)
    }
    this.setState({ value })
    this.onClose()
  }
}

export default Select
