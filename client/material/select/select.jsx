import React from 'react'
import TransitionGroup from 'react-addons-css-transition-group'
import FontIcon from '../font-icon.jsx'
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
      isOpened: false,
      value: props.defaultValue,
      overlayPosition: null
    }

    this._positionNeedsUpdating = false
  }

  componentDidMount() {
    this.updateOverlayPosition(this.refs.value)
  }

  componentWillReceiveProps() {
    this._positionNeedsUpdating = true
  }

  componentDidUpdate() {
    if (this._positionNeedsUpdating) {
      this._positionNeedsUpdating = false
      this.updateOverlayPosition()
    }

    if (this.refs.overlay) {
      // update the scroll position to center (or at least attempt to) the selected value
      const valueIndex = this._getValueIndex()
      const firstDisplayed = this._getFirstDisplayedOptionIndex(
          valueIndex, React.Children.count(this.props.children))
      this.refs.overlay.scrollTop = firstDisplayed * 48
    }
  }

  updateOverlayPosition() {
    const rect = this.refs.root.getBoundingClientRect()
    const overlayPosition = {
      top: rect.top,
      left: rect.left,
      width: rect.width,
    }

    // Calling setState in componentDidMount is not recommended, but it's the only place we can
    // access the DOM element to find its position
    this.setState({ overlayPosition })
  }

  render() {
    return (
      <TransitionGroup transitionName={transitionNames}
          transitionEnterTimeout={250} transitionLeaveTimeout={250}>
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

    return (<div className={styles.select} onClick={::this.onOpen} ref='root'>
      <span className={styles.value} ref='value'>{displayValue}</span>
      <span className={styles.icon}><FontIcon>arrow_drop_down</FontIcon></span>
    </div>)
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

  onOpen() {
    this.setState({ isOpened: true })
  }

  onClose() {
    this.setState({ isOpened: false })
  }

  onOptionChanged(value) {
    this.setState({ value, isOpened: false })
  }
}

export default Select
