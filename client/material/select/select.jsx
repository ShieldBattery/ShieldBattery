import React from 'react'
import PropTypes from 'prop-types'
import keycode from 'keycode'
import styled from 'styled-components'

import FloatingLabel from '../input-floating-label.jsx'
import InputBase from '../input-base.jsx'
import InputError from '../input-error.jsx'
import InputUnderline from '../input-underline.jsx'
import KeyListener from '../../keyboard/key-listener.jsx'
import Menu from '../menu/menu.jsx'
import Portal from '../portal.jsx'
import WindowListener from '../../dom/window-listener.jsx'

import ArrowDropDownIcon from '../../icons/material/ic_arrow_drop_down_black_24px.svg'

import { fastOutSlowIn } from '../curve-constants'
import { zIndexMenuBackdrop } from '../zindex'
import { amberA400, colorTextFaint, colorTextPrimary } from '../../styles/colors'

const SPACE = keycode('space')
const ENTER = keycode('enter')
const TAB = keycode('tab')
const ESCAPE = keycode('escape')
const UP = keycode('up')
const DOWN = keycode('down')

const CLOSE_TIME = 120

const VERT_PADDING = 8
const OPTION_HEIGHT = 48
const OPTIONS_SHOWN = (256 - 16) / OPTION_HEIGHT

const SelectContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  position: relative;
  width: 100%;
  height: 56px;
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
    isClosing: false,
    overlayPosition: null,
    activeIndex: -1,
  }
  _overlayTop = 0
  _closeTimer = null
  _root = React.createRef()
  _overlay = React.createRef()

  componentDidUpdate(prevProps, prevState) {
    if (!prevState.isOpened && this._overlay.current) {
      // update the scroll position to the selected value
      const firstDisplayed = this._getFirstDisplayedOptionIndex()
      this._overlay.current.scrollTop(firstDisplayed * OPTION_HEIGHT)
    }
  }

  componentWillUnmount() {
    clearTimeout(this._closeTimer)
  }

  calculateOverlayPosition() {
    const rect = this._root.current.getBoundingClientRect()
    const overlayPosition = {
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    }

    return overlayPosition
  }

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
    const { isOpened, isClosing, overlayPosition: pos } = this.state
    const renderContents = () => {
      if (!isOpened && !isClosing) return null

      const overlayStyle = {
        top: pos.top + pos.height,
        left: pos.left,
        width: pos.width,
      }
      this._overlayTop = overlayStyle.top

      const valueIndex = this._getValueIndex()
      const options = React.Children.map(this.props.children, (child, i) => {
        return React.cloneElement(child, {
          focused: i === this.state.activeIndex,
          selected: i === valueIndex,
          onOptionSelected: this.onOptionChanged,
        })
      })

      return (
        <span>
          <WindowListener event='resize' listener={this.recalcOverlayPosition} />
          <WindowListener event='scroll' listener={this.recalcOverlayPosition} />
          <Menu ref={this._overlay} open={isOpened && !isClosing} overlayStyle={overlayStyle}>
            {options}
          </Menu>
        </span>
      )
    }

    return (
      <Portal onDismiss={this.onClose} open={isOpened} scrimZIndex={zIndexMenuBackdrop}>
        {renderContents}
      </Portal>
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

  _getFirstDisplayedOptionIndex() {
    const valueIndex = this._getValueIndex()
    const numValues = React.Children.count(this.props.children)
    const lastVisibleIndex = OPTIONS_SHOWN - 1
    if (valueIndex <= lastVisibleIndex || numValues < OPTIONS_SHOWN) {
      return 0
    }
    return Math.min(numValues - OPTIONS_SHOWN, valueIndex - lastVisibleIndex)
  }

  focus() {
    this._root.current.focus()
  }

  blur() {
    this._root.current.blur()
  }

  recalcOverlayPosition = () => {
    this.setState({
      overlayPosition: this.calculateOverlayPosition(),
    })
  }

  _moveActiveIndexBy(delta) {
    let newIndex = this.state.activeIndex
    if (newIndex === -1) {
      newIndex = this._getValueIndex()
    }

    const numOptions = React.Children.count(this.props.children)
    newIndex += delta
    while (newIndex < 0) {
      newIndex += numOptions
    }
    newIndex = newIndex % numOptions

    if (newIndex !== this.state.activeIndex) {
      this.setState({
        activeIndex: newIndex,
      })
    }

    // Adjust scroll position to keep the item in view
    const curTopIndex = Math.ceil(
      Math.max(0, this._overlay.current.getScrollTop() - VERT_PADDING) / OPTION_HEIGHT,
    )
    const curBottomIndex = curTopIndex + OPTIONS_SHOWN - 1 // accounts for partially shown options
    if (newIndex >= curTopIndex && newIndex <= curBottomIndex) {
      // New index is in view, no need to adjust scroll position
      return
    } else if (newIndex < curTopIndex) {
      // Make the new index the top item
      this._overlay.current.scrollTop(VERT_PADDING + OPTION_HEIGHT * newIndex)
    } else {
      // Make the new index the bottom item
      this._overlay.current.scrollTop(OPTION_HEIGHT * (newIndex + 1 - OPTIONS_SHOWN))
    }
  }

  onKeyDown = event => {
    if (!this.state.isFocused) return false

    if (!this.state.isOpened) {
      if (!this.state.isClosing && (event.which === SPACE || event.which === ENTER)) {
        this.onOpen()
        return true
      }
    } else {
      if (event.which === ESCAPE) {
        this.onClose()
        return true
      } else if (event.which === UP) {
        this._moveActiveIndexBy(-1)
        return true
      } else if (event.which === DOWN) {
        this._moveActiveIndexBy(1)
        return true
      } else if (event.which === TAB) {
        if (this.state.activeIndex >= 0) {
          const activeChild = React.Children.toArray(this.props.children)[this.state.activeIndex]
          this.onOptionChanged(activeChild.props.value)
          return true
        }
      } else if (event.which === ENTER) {
        if (this.state.activeIndex >= 0) {
          const activeChild = React.Children.toArray(this.props.children)[this.state.activeIndex]
          this.onOptionChanged(activeChild.props.value)
          return true
        }
      }
    }

    return false
  }

  onOpen = () => {
    clearTimeout(this._closeTimer)
    this._closeTimer = null
    if (!this.props.disabled) {
      this.setState({
        isOpened: true,
        isClosing: false,
        overlayPosition: this.calculateOverlayPosition(),
        activeIndex: this.hasValue() ? this._getValueIndex() : -1,
      })
    }
  }

  onClose = () => {
    this.setState({ isClosing: true, isFocused: true })
    this._closeTimer = setTimeout(
      () => this.setState({ isOpened: false, isClosing: false }),
      CLOSE_TIME,
    )
    this.focus()
  }

  onFocus = () => {
    if (!this.props.disabled) {
      this.setState({ isFocused: true })
    }
  }

  onBlur = () => {
    if (!this.state.isOpened || this.state.isClosing) {
      // If we're opened, leave isFocused since we'll be reassigning focus on close
      this.setState({ isFocused: false })
    }
  }

  onOptionChanged = value => {
    if (this.props.onChange) {
      this.props.onChange(value)
    }
    // NOTE(tec27): the isClosing is necessary here to ensure React doesn't re-render the component
    // with a different value set prior to rendering the component as removed (thus resulting in
    // the overlay jumping around)
    this.setState({ value, isClosing: true })
    this.onClose()
  }
}

export default Select
