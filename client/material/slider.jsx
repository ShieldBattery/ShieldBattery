import React, { PropTypes } from 'react'
import TransitionGroup from 'react-addons-css-transition-group'
import classnames from 'classnames'
import keycode from 'keycode'
import styles from './slider.css'

const balloonTransitionNames = {
  enter: styles.balloonEnter,
  enterActive: styles.balloonEnterActive,
  leave: styles.balloonLeave,
  leaveActive: styles.balloonLeaveActive,
}

const tickTransitionNames = {
  enter: styles.tickEnter,
  enterActive: styles.tickEnterActive,
  leave: styles.tickLeave,
  leaveActive: styles.tickLeaveActive,
}

const LEFT = keycode('left')
const RIGHT = keycode('right')
const HOME = keycode('home')
const END = keycode('end')

const MOUSE_LEFT = 1

const Ticks = ({ show, min, max, step }) => {
  let container
  if (show) {
    const numSteps = (max - min) / step + 1
    const stepPercentage = step / (max - min) * 100
    const elems = []
    for (let i = 0, p = 0; i < numSteps; i++, p = i * stepPercentage) {
      elems.push(<div key={i} className={styles.valueTick} style={{ left: `${p}%` }} />)
    }

    container = <span className={styles.tickContainer}>{elems}</span>
  }

  return (<TransitionGroup transitionName={tickTransitionNames}
      transitionEnterTimeout={150} transitionLeaveTimeout={150}>
    {container}
  </TransitionGroup>)
}

const Track = ({ showTicks, value, min, max, step }) => {
  const scale = (value - min) / (max - min)
  const filledStyle = {
    transform: `scaleX(${scale})`,
  }

  return (<div className={styles.track}>
    <div className={styles.filled} style={filledStyle} />
    <Ticks show={showTicks} min={min} max={max} step={step} />
  </div>)
}

function getInitialValue({ min, max, step, defaultValue }) {
  if (defaultValue !== undefined) {
    return defaultValue
  }

  const range = (max - min) / step
  const midPoint = Math.floor(range / 2)
  return midPoint * step + min
}

class Slider extends React.Component {
  static propTypes = {
    min: PropTypes.number.isRequired,
    max: PropTypes.number.isRequired,
    defaultValue: PropTypes.number,
    step: props => {
      if (typeof props.step !== 'number') {
        return new Error('`step` must be a number.')
      }
      if ((props.max - props.min) % props.step !== 0) {
        return new Error(
            'The range between `min` and `max` needs to be evenly divisible by `step`.')
      }
      return null
    },
    label: PropTypes.string,
    tabIndex: PropTypes.number,
  };

  static defaultProps = {
    step: 1,
    tabIndex: 0,
  };

  constructor(props) {
    super(props)
    this.state = {
      isFocused: false,
      isClicked: false,
      // if defaultValue was not supplied through props, center the slider
      value: getInitialValue(props)
    }

    this._onMouseMove = ::this.onMouseMove
    this._onMouseUp = ::this.onMouseUp

    this._sliderDimensions = null
    this._hasWindowListeners = false
  }

  _addWindowListeners() {
    if (this._hasWindowListeners) return

    window.addEventListener('mousemove', this._onMouseMove)
    window.addEventListener('mouseup', this._onMouseUp)
    this._hasWindowListeners = true
  }

  _removeWindowListeners() {
    if (!this._hasWindowListeners) return

    window.removeEventListener('mousemove', this._onMouseMove)
    window.removeEventListener('mouseup', this._onMouseUp)
    this._hasWindowListeners = false
  }

  componentWillUnmount() {
    this._removeWindowListeners()
  }

  hasValue() {
    return this.state.value !== undefined
  }

  getValue() {
    return this.hasValue() ? this.state.value : this.props.defaultValue
  }

  _renderBalloon(thumbPercent) {
    if (!(this.state.isFocused || this.state.isClicked)) return null

    const className = this.state.value === this.props.min ? styles.balloonEmpty : styles.balloon
    return (<div className={className}>
      <div className={styles.balloonAfter} />
      <span className={styles.balloonText}>{this.state.value}</span>
    </div>)
  }

  render() {
    const classes = classnames(styles.slider, this.props.className, {
      [styles.focused]: this.state.isFocused,
      [styles.disabled]: this.props.disabled,
    })

    const stepPercentage = this.props.step / (this.props.max - this.props.min) * 100

    const optionNum = (this.state.value - this.props.min) / this.props.step
    const thumbPosition = stepPercentage * optionNum

    const labelElement = this.props.label ?
        <label className={styles.label} htmlFor={this.id}>{this.props.label}</label> : null

    const thumbClass = this.state.value === this.props.min ? styles.thumbEmpty : styles.thumb
    const thumbContainerStyle = {
      transform: `translateX(${thumbPosition}%)`,
    }

    return (
      <div ref='root' className={classes} tabIndex={this.props.tabIndex}
        onFocus={::this.onFocus} onBlur={::this.onBlur} onKeyDown={::this.onKeyDown}>
        {labelElement}
        <Track min={this.props.min} max={this.props.max} step={this.props.step}
            value={this.state.value} showTicks={this.state.isClicked} />
        <div className={styles.overflowClip}>
          <div className={styles.thumbContainer} style={thumbContainerStyle}>
            <div className={thumbClass} />
            <TransitionGroup transitionName={balloonTransitionNames}
                transitionEnterTimeout={300} transitionLeaveTimeout={300}>
              {this._renderBalloon(thumbPosition)}
            </TransitionGroup>
          </div>
        </div>
        <div ref='trackArea' className={styles.clickableArea} onMouseDown={::this.onMouseDown}/>
      </div>
    )
  }

  focus() {
    this.refs.root.focus()
  }

  blur() {
    this.refs.root.blur()
  }

  onFocus() {
    this.setState({ isFocused: true })
  }

  onBlur() {
    this.setState({ isFocused: false })
  }

  onKeyDown(event) {
    let handled = false
    if (event.keyCode === LEFT) {
      handled = true
      if (this.state.value !== this.props.min) {
        this.setState({ value: this.state.value - this.props.step })
      }
    } else if (event.keyCode === RIGHT) {
      handled = true
      if (this.state.value !== this.props.max) {
        this.setState({ value: this.state.value + this.props.step })
      }
    } else if (event.keyCode === HOME) {
      handled = true
      if (this.state.value !== this.props.min) {
        this.setState({ value: this.props.min })
      }
    } else if (event.keyCode === END) {
      handled = true
      if (this.state.value !== this.props.max) {
        this.setState({ value: this.props.max })
      }
    }

    if (handled) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  minMaxValidator(value) {
    return Math.max(this.props.min, Math.min(this.props.max, value))
  }

  stepValidator(value) {
    const formattedValue = Math.round(
        (value - this.props.min) / this.props.step) * this.props.step + this.props.min
    // Format to 3 digits after the decimal point; fixes issues when step is a decimal number
    return Math.round(formattedValue * 1000) / 1000
  }

  percentToValue(percent) {
    return this.props.min + percent * (this.props.max - this.props.min)
  }

  positionToPercent(x) {
    return Math.max(0, Math.min(
        1, (x - this._sliderDimensions.left) / (this._sliderDimensions.width)))
  }

  getClosestValue(x) {
    const exactValue = this.percentToValue(this.positionToPercent(x))
    return this.minMaxValidator(this.stepValidator(exactValue))
  }

  onMouseDown(event) {
    if (!(event.buttons & MOUSE_LEFT)) {
      return
    }

    this._addWindowListeners()
    this._sliderDimensions = this.refs.trackArea.getBoundingClientRect()
    this.setState({ value: this.getClosestValue(event.clientX), isClicked: true })
  }

  onMouseMove(event) {
    event.preventDefault()
    const newValue = this.getClosestValue(event.clientX)
    if (newValue !== this.state.value) {
      this.setState({ value: this.getClosestValue(event.clientX) })
    }
  }

  onMouseUp(event) {
    event.preventDefault()
    this._removeWindowListeners()
    this.setState({ value: this.getClosestValue(event.clientX), isClicked: false })
  }
}

export default Slider
