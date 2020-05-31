import React from 'react'
import PropTypes from 'prop-types'
import TransitionGroup from 'react-addons-css-transition-group'
import keycode from 'keycode'
import styled from 'styled-components'
import { Body1, Caption } from '../styles/typography'
import { colorTextFaint, amberA400, grey700, colorTextPrimary } from '../styles/colors'
import { fastOutSlowIn } from './curve-constants'

const transitionNames = {
  enter: 'enter',
  enterActive: 'enterActive',
  leave: 'leave',
  leaveActive: 'leaveActive',
}

const LEFT = keycode('left')
const RIGHT = keycode('right')
const HOME = keycode('home')
const END = keycode('end')

const MOUSE_LEFT = 1

const THUMB_WIDTH_PX = 12
const THUMB_HEIGHT_PX = 12
const BALLOON_WIDTH_PX = 28
const BALLOON_HEIGHT_PX = 28

const TickContainer = styled.span`
  position: absolute;
  width: calc(100% - 12px);
  left: 6px;
  opacity: 1;

  &.enter {
    opacity: 0;
    transition: opacity 150ms linear;
  }

  &.enterActive {
    opacity: 1;
  }

  &.leave {
    opacity: 1;
    transition: opacity 150ms linear;
  }

  &.leaveActive {
    opacity: 0;
  }
`

const ValueTick = styled.div`
  position: absolute;
  width: 2px;
  height: 2px;
  margin-left: -1px;

  background-color: rgba(255, 255, 255, 0.7);
`

const Ticks = ({ show, min, max, step }) => {
  let container
  if (show) {
    const numSteps = (max - min) / step + 1
    const stepPercentage = (step / (max - min)) * 100
    const elems = [
      // left is thumbWidth - 1, to avoid the tick being visible when the thumb is on that value
      <ValueTick key={0} style={{ left: '-5px' }} />,
    ]
    for (let i = 1, p = stepPercentage; i < numSteps - 1; i++, p = i * stepPercentage) {
      elems.push(<ValueTick key={i} style={{ left: `${p}%` }} />)
    }
    elems.push(<ValueTick key={numSteps - 1} style={{ left: 'calc(100% + 5px)' }} />)

    container = <TickContainer>{elems}</TickContainer>
  }

  return (
    <TransitionGroup
      transitionName={transitionNames}
      transitionEnterTimeout={150}
      transitionLeaveTimeout={150}>
      {container}
    </TransitionGroup>
  )
}

const TrackRoot = styled.div`
  position: absolute;
  width: 100%;
  height: 2px;
  left: 0px;
  top: 48px;
  background-color: rgba(255, 255, 255, 0.3);
`

const FilledTrack = styled.div`
  position: absolute;
  left: 0;
  width: 100%;
  height: 2px;

  background-color: ${amberA400};
  transform: scaleX(1);
  transform-origin: 0% 50%;
  transition: transform 150ms ${fastOutSlowIn};
  will-change: transform;
`

const Track = ({ showTicks, value, min, max, step }) => {
  const scale = (value - min) / (max - min)
  const filledStyle = {
    transform: `scaleX(${scale})`,
  }

  return (
    <TrackRoot>
      <FilledTrack style={filledStyle} />
      <Ticks show={showTicks} min={min} max={max} step={step} />
    </TrackRoot>
  )
}

const Root = styled.div`
  height: 64px;
  position: relative;
  contain: layout style;

  ${props => (props.focused ? 'outline: none;' : '')}
`

const SliderLabel = styled(Body1)`
  position: absolute;
  top: 8px;
  left: 2px;

  color: ${colorTextFaint};
  pointer-events: none;
`

const OverflowClip = styled.div`
  position: absolute;
  width: calc(100% + ${BALLOON_WIDTH_PX - THUMB_WIDTH_PX}px);
  height: 100%;
  top: 0;
  left: ${BALLOON_WIDTH_PX / -2 + THUMB_WIDTH_PX / 2}px;
  padding: 0 14px;

  overflow-x: hidden;
  overflow-y: visible;
  pointer-events: none;
`

const ThumbContainer = styled.div`
  position: relative;
  top: ${48 - THUMB_HEIGHT_PX / 2}px;
  width: 100%;
  pointer-events: none;
  will-change: transform;
  transition: transform 150ms ${fastOutSlowIn};
`

const Thumb = styled.div`
  position: absolute;
  width: ${THUMB_WIDTH_PX}px;
  height: ${THUMB_HEIGHT_PX}px;
  left: ${THUMB_WIDTH_PX / -2}px;

  background-color: ${props => (props.empty ? '#ffffff' : amberA400)};
  border-radius: 50%;
  pointer-events: none;
  transition: background-color 200ms linear;
  z-index: 1;
`

const ClickableArea = styled.div`
  position: absolute;
  width: 100%;
  height: 32px;
  left: 0;
  bottom: 0;

  cursor: pointer;
`

const Balloon = styled.div`
  position: absolute;
  width: ${BALLOON_WIDTH_PX}px;
  height: ${BALLOON_HEIGHT_PX}px;
  top: -42px;
  left: ${BALLOON_WIDTH_PX / -2}px;

  display: flex;
  align-items: center;
  justify-content: center;

  background-color: ${props => (props.empty ? grey700 : amberA400)};
  border-radius: 50%;
  color: ${props => (props.empty ? colorTextPrimary : 'rgba(0, 0, 0, 0.87)')};
  pointer-events: none;
  text-align: center;
  transform-origin: 50% 150%;
  transition: transform 150ms ${fastOutSlowIn}, background-color 200ms linear, color 200ms linear;
  will-change: transform, background-color, color;

  &::before {
    position: absolute;
    left: 0;
    top: 19px;

    border-radius: 16px;
    border-top: 16px solid ${props => (props.empty ? grey700 : amberA400)};
    border-left: ${BALLOON_WIDTH_PX / 2}px solid transparent;
    border-right: ${BALLOON_WIDTH_PX / 2}px solid transparent;
    content: '';
    transition: border-top-color 250ms linear;
    will-change: border-top-color;
    z-index: 1;
  }

  &.enter {
    transform: scale(0, 0);
  }

  &.enterActive {
    transform: scale(1, 1);
  }

  &.leave {
    transform: scale(1, 1);
  }

  &.leaveActive {
    transform: scale(0, 0);
  }
`

const BalloonText = styled(Caption)`
  font-weight: 500;
  line-height: ${BALLOON_HEIGHT_PX}px;
  z-index: 2;
`

class Slider extends React.Component {
  static propTypes = {
    min: PropTypes.number.isRequired,
    max: PropTypes.number.isRequired,
    value: PropTypes.number.isRequired,
    step: props => {
      if (typeof props.step !== 'number') {
        return new Error('`step` must be a number.')
      }
      if ((props.max - props.min) % props.step !== 0) {
        return new Error(
          'The range between `min` and `max` needs to be evenly divisible by `step`.',
        )
      }
      return null
    },
    label: PropTypes.string,
    tabIndex: PropTypes.number,
    onChange: PropTypes.func,
  }

  static defaultProps = {
    step: 1,
    tabIndex: 0,
  }

  state = {
    isFocused: false,
    isClicked: false,
  }
  rootRef = React.createRef()
  trackAreaRef = React.createRef()
  _sliderDimensions = null
  _hasWindowListeners = false

  _addWindowListeners() {
    if (this._hasWindowListeners) return

    window.addEventListener('mousemove', this.onMouseMove)
    window.addEventListener('mouseup', this.onMouseUp)
    this._hasWindowListeners = true
  }

  _removeWindowListeners() {
    if (!this._hasWindowListeners) return

    window.removeEventListener('mousemove', this.onMouseMove)
    window.removeEventListener('mouseup', this.onMouseUp)
    this._hasWindowListeners = false
  }

  componentWillUnmount() {
    this._removeWindowListeners()
  }

  _renderBalloon(thumbPercent) {
    if (!(this.state.isFocused || this.state.isClicked)) return null

    return (
      <Balloon empty={this.props.value === this.props.min}>
        <BalloonText as='span'>{this.props.value}</BalloonText>
      </Balloon>
    )
  }

  render() {
    const stepPercentage = (this.props.step / (this.props.max - this.props.min)) * 100

    const optionNum = (this.props.value - this.props.min) / this.props.step
    const thumbPosition = stepPercentage * optionNum

    const labelElement = this.props.label ? (
      <SliderLabel as='label' htmlFor={this.id}>
        {this.props.label}
      </SliderLabel>
    ) : null

    const thumbContainerStyle = {
      transform: `translateX(${thumbPosition}%)`,
    }

    // TODO(tec27): implement disabled state
    return (
      <Root
        ref={this.rootRef}
        focused={this.state.isFocused}
        disabled={this.props.disabled}
        className={this.props.className}
        tabIndex={this.props.tabIndex}
        onFocus={this.onFocus}
        onBlur={this.onBlur}
        onKeyDown={this.onKeyDown}>
        {labelElement}
        <Track
          min={this.props.min}
          max={this.props.max}
          step={this.props.step}
          value={this.props.value}
          showTicks={this.state.isClicked}
        />
        <OverflowClip>
          <ThumbContainer style={thumbContainerStyle}>
            <Thumb empty={this.props.value === this.props.min} />
            <TransitionGroup
              transitionName={transitionNames}
              transitionEnterTimeout={300}
              transitionLeaveTimeout={300}>
              {this._renderBalloon(thumbPosition)}
            </TransitionGroup>
          </ThumbContainer>
        </OverflowClip>
        <ClickableArea ref={this.trackAreaRef} onMouseDown={this.onMouseDown} />
      </Root>
    )
  }

  focus() {
    this.rootRef.current.focus()
  }

  blur() {
    this.rootRef.current.blur()
  }

  onFocus = () => {
    this.setState({ isFocused: true })
  }

  onBlur = () => {
    this.setState({ isFocused: false })
  }

  onKeyDown = event => {
    let handled = false
    if (event.keyCode === LEFT) {
      handled = true
      if (this.props.value !== this.props.min) {
        this.onChange(this.props.value - this.props.step)
      }
    } else if (event.keyCode === RIGHT) {
      handled = true
      if (this.props.value !== this.props.max) {
        this.onChange(this.props.value + this.props.step)
      }
    } else if (event.keyCode === HOME) {
      handled = true
      if (this.props.value !== this.props.min) {
        this.onChange(this.props.min)
      }
    } else if (event.keyCode === END) {
      handled = true
      if (this.props.value !== this.props.max) {
        this.onChange(this.props.max)
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
    const formattedValue =
      Math.round((value - this.props.min) / this.props.step) * this.props.step + this.props.min
    // Format to 3 digits after the decimal point; fixes issues when step is a decimal number
    return Math.round(formattedValue * 1000) / 1000
  }

  percentToValue(percent) {
    return this.props.min + percent * (this.props.max - this.props.min)
  }

  positionToPercent(x) {
    return Math.max(
      0,
      Math.min(1, (x - this._sliderDimensions.left) / this._sliderDimensions.width),
    )
  }

  getClosestValue(x) {
    const exactValue = this.percentToValue(this.positionToPercent(x))
    return this.minMaxValidator(this.stepValidator(exactValue))
  }

  onMouseDown = event => {
    if (!(event.buttons & MOUSE_LEFT)) {
      return
    }

    this._addWindowListeners()
    this._sliderDimensions = this.trackAreaRef.current.getBoundingClientRect()
    this.setState({ isClicked: true })
    const newValue = this.getClosestValue(event.clientX)
    if (newValue !== this.props.value) {
      this.onChange(newValue)
    }
  }

  onMouseMove = event => {
    event.preventDefault()
    const newValue = this.getClosestValue(event.clientX)
    if (newValue !== this.props.value) {
      this.onChange(newValue)
    }
  }

  onMouseUp = event => {
    event.preventDefault()
    this._removeWindowListeners()
    this.setState({ isClicked: false })
    const newValue = this.getClosestValue(event.clientX)
    if (newValue !== this.props.value) {
      this.onChange(newValue)
    }
  }

  onChange = newValue => {
    if (this.props.onChange) {
      this.props.onChange(newValue)
    }
  }
}

export default Slider
