import React from 'react'
import PropTypes from 'prop-types'
import TransitionGroup from 'react-addons-css-transition-group'
import classnames from 'classnames'
import keycode from 'keycode'
import styles from './select.css'

import ArrowDropDownIcon from '../../icons/material/ic_arrow_drop_down_black_24px.svg'
import FloatingLabel from '../input-floating-label.jsx'
import InputError from '../input-error.jsx'
import InputUnderline from '../input-underline.jsx'
import KeyListener from '../../keyboard/key-listener.jsx'
import Portal from '../portal.jsx'
import WindowListener from '../../dom/window-listener.jsx'

const transitionNames = {
  appear: styles.enter,
  appearActive: styles.enterActive,
  enter: styles.enter,
  enterActive: styles.enterActive,
  leave: styles.leave,
  leaveActive: styles.leaveActive,
}

const SPACE = keycode('space')
const ENTER = keycode('enter')
const TAB = keycode('tab')
const ESCAPE = keycode('escape')
const UP = keycode('up')
const DOWN = keycode('down')

const CLOSE_TIME = 200

const VERT_PADDING = 8
const OPTION_HEIGHT = 48
const OPTIONS_SHOWN = (256 - 16) / OPTION_HEIGHT

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
  _lastMouseY = -1
  _closeTimer = null
  _root = null
  _setRoot = elem => {
    this._root = elem
  }
  _overlay = null
  _setOverlay = elem => {
    this._overlay = elem
  }

  componentDidUpdate(prevProps, prevState) {
    if (!prevState.isOpened && this._overlay) {
      // update the scroll position to center (or at least attempt to) the selected value
      const valueIndex = this._getValueIndex()
      const firstDisplayed = this._getFirstDisplayedOptionIndex(
        valueIndex,
        React.Children.count(this.props.children),
      )
      this._overlay.scrollTop = firstDisplayed * OPTION_HEIGHT
      this._lastMouseY = -1
    }
  }

  componentWillUnmount() {
    clearTimeout(this._closeTimer)
  }

  calculateOverlayPosition() {
    const rect = this._root.getBoundingClientRect()
    const overlayPosition = {
      top: rect.top,
      left: rect.left,
      width: rect.width,
    }

    return overlayPosition
  }

  hasValue() {
    return this.props.value !== undefined
  }

  render() {
    return (
      <span className={this.props.className}>
        <KeyListener onKeyDown={this.onKeyDown} onKeyPress={this.onKeyPress} />
        {this.renderSelect()}
        {this.renderOverlay()}
      </span>
    )
  }

  renderSelect() {
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
    if (displayValue === undefined || displayValue === '') {
      displayValue = '\xA0' // &nbsp; to ensure the height is the same, with or without text
    }

    const classes = classnames(styles.select, {
      [styles.focused]: this.state.isFocused,
      [styles.disabled]: this.props.disabled,
    })

    return (
      <div className={classes} onClick={this.onOpen}>
        {this.renderLabel()}
        <span
          ref={this._setRoot}
          className={styles.valueContainer}
          tabIndex={this.props.disabled ? undefined : this.props.tabIndex || 0}
          onFocus={this.onFocus}
          onBlur={this.onBlur}>
          <span className={styles.value}>{displayValue}</span>
          <span className={styles.icon}>
            <ArrowDropDownIcon />
          </span>
        </span>
        <InputUnderline
          focused={this.state.isFocused}
          error={!!this.props.errorText}
          disabled={this.props.disabled}
        />
        {this.props.allowErrors ? <InputError error={this.props.errorText} /> : null}
      </div>
    )
  }

  renderLabel() {
    if (!this.props.label) {
      return null
    }

    return (
      <FloatingLabel
        htmlFor={this.id}
        text={this.props.label}
        hasValue={this.hasValue()}
        focused={this.state.isFocused}
        disabled={this.props.disabled}
        error={!!this.props.errorText}
      />
    )
  }

  renderOverlay() {
    const { isOpened, isClosing, overlayPosition: pos } = this.state
    const renderContents = () => {
      if (!isOpened && !isClosing) return null

      const valueIndex = this._getValueIndex()
      const firstDisplayed = this._getFirstDisplayedOptionIndex(
        valueIndex,
        React.Children.count(this.props.children),
      )
      const valueOffset = (valueIndex - firstDisplayed) * OPTION_HEIGHT

      const overlayStyle = {
        // Subtract the padding so the select-option perfectly overlaps with select-value
        top: pos.top - 14 - valueOffset,
        left: pos.left - 16 + 2,
        minWidth: pos.width + 32,
        transformOrigin: `0 ${valueOffset + 24}px`,
      }
      this._overlayTop = overlayStyle.top

      const options = React.Children.map(this.props.children, (child, i) => {
        return React.cloneElement(child, {
          active: i === this.state.activeIndex,
          onOptionSelected: this.onOptionChanged,
        })
      })

      return (
        <span>
          <WindowListener event='resize' listener={this.recalcOverlayPosition} />
          <WindowListener event='scroll' listener={this.recalcOverlayPosition} />
          <TransitionGroup
            transitionName={transitionNames}
            transitionAppear={true}
            transitionAppearTimeout={200}
            transitionEnterTimeout={200}
            transitionLeaveTimeout={CLOSE_TIME}>
            {isOpened && !isClosing ? (
              <div
                key='overlay'
                ref={this._setOverlay}
                className={styles.overlay}
                style={overlayStyle}
                onMouseMove={this.onMouseMove}>
                {options}
              </div>
            ) : null}
          </TransitionGroup>
        </span>
      )
    }

    return (
      <Portal onDismiss={this.onClose} open={isOpened}>
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

  _getFirstDisplayedOptionIndex(valueIndex, numValues) {
    const midpoint = Math.ceil(OPTIONS_SHOWN / 2) - 1
    if (valueIndex <= midpoint || numValues < OPTIONS_SHOWN) {
      return 0
    }
    return Math.min(numValues - OPTIONS_SHOWN, valueIndex - midpoint)
  }

  focus() {
    this._root.focus()
  }

  blur() {
    this._root.blur()
  }

  recalcOverlayPosition = () => {
    this.setState({
      overlayPosition: this.calculateOverlayPosition(),
    })
  }

  onMouseMove = event => {
    if (event.clientY === this._lastMouseY) {
      // mouse move must have been caused by a scroll (but the mouse didn't actually move),
      // ignore it
      return
    }

    this._lastMouseY = event.clientY
    let localY = event.clientY - (this._overlayTop + VERT_PADDING)
    localY += this._overlay.scrollTop
    const numOptions = React.Children.count(this.props.children)
    const itemIndex = Math.min(numOptions - 1, Math.max(0, Math.floor(localY / OPTION_HEIGHT)))
    if (itemIndex !== this.state.activeIndex) {
      this.setState({
        activeIndex: itemIndex,
      })
    }
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
      Math.max(0, this._overlay.scrollTop - VERT_PADDING) / OPTION_HEIGHT,
    )
    const curBottomIndex = curTopIndex + OPTIONS_SHOWN - 1 // accounts for partially shown options
    if (newIndex >= curTopIndex && newIndex <= curBottomIndex) {
      // New index is in view, no need to adjust scroll position
      return
    } else if (newIndex < curTopIndex) {
      // Make the new index the top item
      this._overlay.scrollTop = VERT_PADDING + OPTION_HEIGHT * newIndex
    } else {
      // Make the new index the bottom item
      this._overlay.scrollTop = OPTION_HEIGHT * (newIndex + 1 - OPTIONS_SHOWN)
    }
  }

  onKeyPress = event => {
    if (!this.state.isOpened && this.state.isFocused) {
      if (!this.state.isClosing && (event.which === SPACE || event.which === ENTER)) {
        this.onOpen()
        return true
      }
    } else {
      if (event.which === ENTER) {
        if (this.state.activeIndex >= 0) {
          const activeChild = React.Children.toArray(this.props.children)[this.state.activeIndex]
          this.onOptionChanged(activeChild.props.value)
          return true
        }
      }
    }

    return false
  }

  onKeyDown = event => {
    // Only handle things that can't be handled with keypress
    if (this.state.isOpened) {
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
