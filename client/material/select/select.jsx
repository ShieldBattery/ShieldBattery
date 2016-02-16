import React, { PropTypes } from 'react'
import TransitionGroup from 'react-addons-css-transition-group'
import classnames from 'classnames'
import keycode from 'keycode'
import styles from './select.css'

import FloatingLabel from '../input-floating-label.jsx'
import FontIcon from '../font-icon.jsx'
import MenuBackdrop from '../menu/backdrop.jsx'
import InputError from '../input-error.jsx'
import InputUnderline from '../input-underline.jsx'
import WindowListener from '../../dom/window-listener.jsx'

const transitionNames = {
  enter: styles.enter,
  enterActive: styles.enterActive,
  leave: styles.leave,
  leaveActive: styles.leaveActive,
}

const SPACE = keycode('space')
const ENTER = keycode('enter')
const ESCAPE = keycode('escape')
const UP = keycode('up')
const DOWN = keycode('down')

const VERT_PADDING = 8
const OPTION_HEIGHT = 48
const OPTIONS_SHOWN = (256 - 16) / OPTION_HEIGHT

class Select extends React.Component {
  static propTypes = {
    allowErrors: PropTypes.bool,
    errorText: PropTypes.string,
    label: PropTypes.string,
    onValueChanged: React.PropTypes.func,
  };

  static defaultProps = {
    allowErrors: true,
  };

  constructor(props) {
    super(props)
    this.state = {
      isFocused: false,
      isOpened: false,
      value: props.defaultValue !== undefined ? props.defaultValue : null,
      overlayPosition: null,
      activeIndex: -1,
    }
    this._optionChangeHandler = ::this.onOptionChanged
    this._handleRecalc = ::this.recalcOverlayPosition
    this._handleMouseMove = ::this.onMouseMove

    this._overlayTop = 0
    this._lastMouseY = -1
  }

  componentDidUpdate(prevProps, prevState) {
    if (!prevState.isOpened && this.refs.overlay) {
      // update the scroll position to center (or at least attempt to) the selected value
      const valueIndex = this._getValueIndex()
      const firstDisplayed = this._getFirstDisplayedOptionIndex(
          valueIndex, React.Children.count(this.props.children))
      this.refs.overlay.scrollTop = firstDisplayed * OPTION_HEIGHT
      this._lastMouseY = -1
    }
  }

  componentWillReceiveProps(nextProps) {
    const hasNewDefault = nextProps.defaultValue !== this.props.defaultValue

    if (hasNewDefault) {
      this.setState({ value: nextProps.defaultValue })
    }
  }

  calculateOverlayPosition() {
    const rect = this.refs.root.getBoundingClientRect()
    const overlayPosition = {
      top: rect.top,
      left: rect.left,
      width: rect.width,
    }

    return overlayPosition
  }

  hasValue() {
    return this.state.value !== undefined
  }

  getValue() {
    return this.hasValue() ? this.state.value : undefined
  }

  render() {
    return (
      <TransitionGroup transitionName={transitionNames} className={this.props.className}
          transitionEnterTimeout={200} transitionLeaveTimeout={200}>
        { this.renderSelect() }
        { this.renderOverlay() }
      </TransitionGroup>
    )
  }

  renderSelect() {
    let displayValue
    if (this.hasValue()) {
      React.Children.forEach(this.props.children, child => {
        if (this.state.value === child.props.value) {
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
      <div className={classes} onClick={::this.onOpen} onKeyPress={::this.onKeyPress}
          onKeyDown={::this.onKeyDown}>
        {this.renderLabel()}
        <span ref='root' className={styles.valueContainer}
            tabIndex={this.props.disabled ? undefined : (this.props.tabIndex || 0)}
            onFocus={::this.onFocus} onBlur={::this.onBlur}>
          <span className={styles.value} ref='value'>{displayValue}</span>
          <span className={styles.icon}><FontIcon>arrow_drop_down</FontIcon></span>
        </span>
        <InputUnderline focused={this.state.isFocused} error={!!this.props.errorText}
            disabled={this.props.disabled} />
        {this.props.allowErrors ? <InputError error={this.props.errorText} /> : null}
      </div>
    )
  }

  renderLabel() {
    if (!this.props.label) {
      return null
    }

    return (
      <FloatingLabel htmlFor={this.id} text={this.props.label} hasValue={this.hasValue()}
          focused={this.state.isFocused} disabled={this.props.disabled}
          error={!!this.props.errorText} />
    )
  }

  renderOverlay() {
    if (!this.state.isOpened) return null

    const pos = this.state.overlayPosition
    const valueIndex = this._getValueIndex()
    const firstDisplayed = this._getFirstDisplayedOptionIndex(
        valueIndex, React.Children.count(this.props.children))
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
        onOptionSelected: this._optionChangeHandler,
      })
    })

    return [
      <WindowListener key='listenerResize' event='resize' listener={this._handleRecalc} />,
      <WindowListener key='listenerScroll' event='scroll' listener={this._handleRecalc} />,
      <MenuBackdrop key='backdrop' onClick={::this.onClose} />,
      <div key='overlay' ref='overlay' className={styles.overlay} style={overlayStyle}
          onMouseMove={this._handleMouseMove}>
        {options}
      </div>
    ]
  }

  _getValueIndex() {
    let valueIndex = 0
    if (this.hasValue()) {
      React.Children.forEach(this.props.children, (child, i) => {
        if (this.state.value === child.props.value) {
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
    this.refs.root.focus()
  }

  blur() {
    this.refs.root.blur()
  }

  recalcOverlayPosition() {
    this.setState({
      overlayPosition: this.calculateOverlayPosition(),
    })
  }

  onMouseMove(event) {
    if (event.clientY === this._lastMouseY) {
      // mouse move must have been caused by a scroll (but the mouse didn't actually move),
      // ignore it
      return
    }

    this._lastMouseY = event.clientY
    let localY = event.clientY - (this._overlayTop + VERT_PADDING)
    localY += this.refs.overlay.scrollTop
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
    const curTopIndex =
        Math.ceil(Math.max(0, (this.refs.overlay.scrollTop - VERT_PADDING)) / OPTION_HEIGHT)
    const curBottomIndex = curTopIndex + OPTIONS_SHOWN - 1 // accounts for partially shown options
    if (newIndex >= curTopIndex && newIndex <= curBottomIndex) {
      // New index is in view, no need to adjust scroll position
      return
    } else if (newIndex < curTopIndex) {
      // Make the new index the top item
      this.refs.overlay.scrollTop = VERT_PADDING + (OPTION_HEIGHT * newIndex)
    } else {
      // Make the new index the bottom item
      this.refs.overlay.scrollTop = (OPTION_HEIGHT * ((newIndex + 1) - OPTIONS_SHOWN))
    }
  }

  onKeyPress(event) {
    let handled = false
    if (!this.state.isOpened) {
      if (event.which === SPACE || event.which === ENTER) {
        handled = true
        this.onOpen()
      }
    } else {
      if (event.which === ENTER) {
        if (this.state.activeIndex >= 0) {
          const activeChild = React.Children.toArray(this.props.children)[this.state.activeIndex]
          this.onOptionChanged(activeChild.props.value)
        }
      }
    }


    if (handled) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  onKeyDown(event) {
    // Only handle things that can't be handled with keypress
    let handled = false
    if (this.state.isOpened) {
      if (event.which === ESCAPE) {
        handled = true
        this.onClose()
      } else if (event.which === UP) {
        handled = true
        this._moveActiveIndexBy(-1)
      } else if (event.which === DOWN) {
        handled = true
        this._moveActiveIndexBy(1)
      }
    }

    if (handled) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  onOpen() {
    if (!this.props.disabled) {
      this.setState({
        isOpened: true,
        overlayPosition: this.calculateOverlayPosition(),
        activeIndex: this.hasValue() ? this._getValueIndex() : -1,
      })
    }
  }

  onClose() {
    this.setState({ isOpened: false, isFocused: true })
    this.focus()
  }

  onFocus() {
    if (!this.props.disabled) {
      this.setState({ isFocused: true })
    }
  }

  onBlur() {
    if (!this.state.isOpened) {
      // If we're opened, leave isFocused since we'll be reassigning focus on close
      this.setState({ isFocused: false })
    }
  }

  onOptionChanged(value) {
    if (this.props.onValueChanged) {
      this.props.onValueChanged(value)
    }
    this.setState({ value, isOpened: false, isFocused: true })
    this.focus()
  }
}

export default Select
