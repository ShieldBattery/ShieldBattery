import React from 'react'
import TransitionGroup from 'react-addons-css-transition-group'
import classnames from 'classnames'
import FontIcon from '../font-icon.jsx'
import keycode from 'keycode'
import styles from './select.css'

const transitionNames = {
  enter: styles.enter,
  enterActive: styles.enterActive,
  leave: styles.leave,
  leaveActive: styles.leaveActive,
}

const OPTIONS_SHOWN = (256 - 16) / 48

class Select extends React.Component {
  constructor(props) {
    super(props)
    this.state = {
      isFocused: false,
      isOpened: false,
      value: props.defaultValue,
      hoveredValue: props.defaultValue,
      hoverSource: null,
      overlayPosition: null
    }

    this._positionNeedsUpdating = false
    this._mousePositionCache = { x: 0, y: 0 }
    this._mousePositionOnKeypress = { x: 0, y: 0 }
  }

  componentDidUpdate(prevProps, prevState) {
    if (this.refs.overlay) {
      if (!prevState.isOpened && this.state.isOpened) {
        // update the scroll position to center (or at least attempt to) the selected value
        const valueIndex = this._getValueIndex()
        const firstDisplayed = this._getFirstDisplayedOptionIndex(
            valueIndex, React.Children.count(this.props.children))
        this.refs.overlay.scrollTop = firstDisplayed * 48
      } else if (prevState.hoveredValue > this.state.hoveredValue &&
        this.state.hoverSource === 'keyup') {
        const valueIndex = this._getHoveredValueIndex()
        const firstDisplayed = this._getFirstDisplayedOptionIndexWhileScrollingUp(
            valueIndex, React.Children.count(this.props.children))
        this.refs.overlay.scrollTop = firstDisplayed * 48
      } else if (prevState.hoveredValue < this.state.hoveredValue &&
        this.state.hoverSource === 'keydown') {
        const valueIndex = this._getHoveredValueIndex()
        const firstDisplayed = this._getFirstDisplayedOptionIndexWhileScrollingDown(
            valueIndex, React.Children.count(this.props.children))
        this.refs.overlay.scrollTop = firstDisplayed * 48
      }
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
    React.Children.forEach(this.props.children, child => {
      if (this.state.value === child.props.value) {
        displayValue = child.props.text
      }
    })

    const classes = classnames(styles.select, {
      [styles.focused]: this.state.isFocused,
      [styles.disabled]: this.props.disabled,
    })

    return (
      <div ref='root' className={classes} tabIndex={this.props.disabled ? undefined : 0}
          onClick={::this.onOpen} onFocus={::this.onFocus} onBlur={::this.onBlur}
          onKeyUp={::this.onKeyUp}>
        <span className={styles.value} ref='value'>{displayValue}</span>
        <span className={styles.icon}><FontIcon>arrow_drop_down</FontIcon></span>
      </div>
    )
  }

  renderOverlay() {
    if (!this.state.isOpened) return null

    const pos = this.state.overlayPosition
    const valueIndex = this._getValueIndex()
    const firstDisplayed = this._getFirstDisplayedOptionIndex(
        valueIndex, React.Children.count(this.props.children))
    const valueOffset = (valueIndex - firstDisplayed) * 48

    const overlayStyle = {
      // Subtract the padding so the select-option perfectly overlaps with select-value
      top: pos.top - 18 - valueOffset,
      left: pos.left - 16 + 2,
      minWidth: pos.width + 32,
      transformOrigin: `0 ${valueOffset + 24}px`,
    }

    const options = React.Children.map(this.props.children, child => {
      return React.cloneElement(child, {
        hoveredValue: this.state.hoveredValue,
        onMouseOver: (event) => this.onMouseOver(event, child.props.value),
        onMouseMove: (event) => this.onMouseMove(event),
        onOptionChange: () => this.onOptionChanged(child.props.value)
      })
    })

    return [
      <div key='backdrop' className={styles.backdrop} onClick={::this.onClose} />,
      <div key='overlay' ref='overlay' className={styles.overlay} style={overlayStyle}>
        {options}
      </div>
    ]
  }

  _getValueIndex() {
    let valueIndex = 0
    React.Children.forEach(this.props.children, (child, i) => {
      if (this.state.value === child.props.value) {
        valueIndex = i
      }
    })
    return valueIndex
  }

  _getFirstDisplayedOptionIndex(valueIndex, numValues) {
    const midpoint = Math.ceil(OPTIONS_SHOWN / 2) - 1
    if (valueIndex <= midpoint || numValues < OPTIONS_SHOWN) {
      return 0
    }
    return Math.min(numValues - OPTIONS_SHOWN, valueIndex - midpoint)
  }

  _getHoveredValueIndex() {
    let hoveredValueIndex = 0
    React.Children.forEach(this.props.children, (child, i) => {
      if (this.state.hoveredValue === child.props.value) {
        hoveredValueIndex = i
      }
    })
    return hoveredValueIndex
  }

  _getFirstDisplayedOptionIndexWhileScrollingDown(hoveredValueIndex, numValues) {
    const bottomPoint = OPTIONS_SHOWN - 1
    if (hoveredValueIndex < bottomPoint) {
      return 0
    }
    return Math.min(numValues - OPTIONS_SHOWN, hoveredValueIndex - bottomPoint)
  }

  _getFirstDisplayedOptionIndexWhileScrollingUp(hoveredValueIndex, numValues) {
    const topPoint = numValues - OPTIONS_SHOWN
    if (hoveredValueIndex > topPoint) {
      return topPoint
    }
    return Math.max(0, hoveredValueIndex)
  }

  focus() {
    this.refs.root.focus()
  }

  blur() {
    this.refs.root.blur()
  }

  onOpen() {
    if (!this.props.disabled) {
      this.setState({
        isOpened: true,
        overlayPosition: this.calculateOverlayPosition()
      })
    }
  }

  onClose() {
    this.setState({ isOpened: false })
  }

  onFocus() {
    if (!this.props.disabled) {
      this.setState({ isFocused: true })
    }
  }

  onBlur() {
    this.setState({ isFocused: false })
  }

  onOptionChanged(value) {
    this.setState({ value, isOpened: false })
  }

  onMouseOver(event, value) {
    if (event.clientX !== this._mousePositionOnKeypress.x ||
      event.clientY !== this._mousePositionOnKeypress.y) {
      this.setState({ hoveredValue: value, hoverSource: 'mouseover' })
    }
  }

  onMouseMove(event) {
    this._mousePositionCache = { x: event.clientX, y: event.clientY }
  }

  onKeyUp(event) {
    switch (event.keyCode) {
      case keycode('esc'):
        if (this.state.isOpened) {
          this.onClose()
          event.stopPropagation()
        }
        break
      case keycode('space'):
      case keycode('enter'):
        if (!this.state.isOpened) {
          this.onOpen()
        } else {
          this.onOptionChanged(this.state.hoveredValue)
          this.onClose()
        }
        event.stopPropagation()
        break
      case keycode('up'):
        if (!this.state.isOpened) {
          this.onOpen()
        } else {
          if (this.state.hoveredValue > 1) {
            this.setState({ hoveredValue: this.state.hoveredValue - 1, hoverSource: 'keyup' })
          }
          this._mousePositionOnKeypress = {
            x: this._mousePositionCache.x,
            y: this._mousePositionCache.y
          }
        }
        event.stopPropagation()
        break
      case keycode('down'):
        if (!this.state.isOpened) {
          this.onOpen()
        } else {
          if (this.state.hoveredValue < React.Children.count(this.props.children)) {
            this.setState({ hoveredValue: this.state.hoveredValue + 1, hoverSource: 'keydown' })
          }
          this._mousePositionOnKeypress = {
            x: this._mousePositionCache.x,
            y: this._mousePositionCache.y
          }
        }
        event.stopPropagation()
        break
    }
  }
}

export default Select
