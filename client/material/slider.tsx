import keycode from 'keycode'
import { AnimatePresence, Transition, Variants } from 'motion/react'
import * as m from 'motion/react-m'
import React, { useEffect, useId, useRef, useState } from 'react'
import styled from 'styled-components'
import { useStableCallback } from '../react/state-hooks'
import { labelLarge, labelMedium } from '../styles/typography'
import { standardEasing } from './curve-constants'

const LEFT = keycode('left')
const RIGHT = keycode('right')
const HOME = keycode('home')
const END = keycode('end')

const MOUSE_LEFT = 1

const THUMB_WIDTH_PX = 20
const THUMB_HEIGHT_PX = 20
const BALLOON_WIDTH_PX = 28
const BALLOON_HEIGHT_PX = 28

const tickVariants: Variants = {
  hidden: {
    opacity: 0,
  },
  visible: {
    opacity: 1,
  },
}

const tickTransition: Transition = {
  type: 'spring',
  duration: 0.15,
  bounce: 0,
}

const TickContainer = styled(m.span)`
  position: absolute;
  width: calc(100% - 12px);
  height: 100%;
  left: 6px;
  display: flex;
  align-items: center;
`

const ValueTick = styled.div<{ $filled?: boolean }>`
  position: absolute;
  width: 2px;
  height: 2px;
  margin-left: -1px;
  border-radius: 50%;
  background-color: ${props =>
    props.$filled
      ? 'rgb(from var(--theme-on-amber) r g b / 0.38)'
      : 'rgb(from var(--theme-on-surface-variant) r g b / 0.38)'};
`

interface TicksProps {
  show: boolean
  value: number
  min: number
  max: number
  step: number
}

function Ticks({ show, value, min, max, step }: TicksProps) {
  let content = null
  if (show) {
    const numSteps = (max - min) / step + 1
    const stepPercentage = (step / (max - min)) * 100
    const optionNum = (value - min) / step
    const elems = [
      // left is thumbWidth - 1, to avoid the tick being visible when the thumb is on that value
      <ValueTick key={0} $filled={true} style={{ left: '-5px' }} />,
    ]
    for (let i = 1, p = stepPercentage; i < numSteps - 1; i++, p = i * stepPercentage) {
      elems.push(<ValueTick key={i} $filled={i < optionNum} style={{ left: `${p}%` }} />)
    }
    elems.push(<ValueTick key={numSteps - 1} style={{ left: 'calc(100% + 5px)' }} />)

    content = elems
  }

  return (
    <AnimatePresence>
      {show && (
        <TickContainer
          variants={tickVariants}
          initial='hidden'
          animate='visible'
          exit='hidden'
          transition={tickTransition}>
          {content}
        </TickContainer>
      )}
    </AnimatePresence>
  )
}

const TrackRoot = styled.div<{ $disabled?: boolean }>`
  position: absolute;
  width: 100%;
  height: 4px;
  left: 0px;
  top: 54px;
  border-radius: 4px;
  background-color: ${props =>
    props.$disabled
      ? 'rgb(from var(--theme-on-surface) r g b / calc(1 / var(--theme-disabled-opacity) * 0.12))'
      : 'rgb(from var(--theme-on-surface) r g b / 0.12)'};
`

// This wrapper is needed to make sure the border-radius doesn't get scaled with the filled track.
const FilledTrackWrapper = styled.div`
  position: absolute;
  left: 0;
  top: -1px;
  width: 100%;
  height: 6px;
  border-radius: 3px;
  overflow: hidden;
`

const FilledTrack = styled.div<{ $disabled?: boolean }>`
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  background-color: ${props =>
    props.$disabled ? 'var(--theme-on-surface)' : 'var(--theme-amber)'};

  transform: scaleX(1);
  transform-origin: 0% 50%;
  transition: transform 150ms ${standardEasing};
  will-change: transform;
`

interface TrackProps {
  disabled?: boolean
  showTicks: boolean
  value: number
  min: number
  max: number
  step: number
  transitionDuration?: number
}

function Track({
  disabled,
  showTicks,
  value,
  min,
  max,
  step,
  transitionDuration = 150,
}: TrackProps) {
  const scale = (value - min) / (max - min)
  const filledStyle = {
    transform: `scaleX(${scale})`,
    transitionDuration: `${transitionDuration}ms`,
  }

  return (
    <TrackRoot $disabled={disabled}>
      <FilledTrackWrapper>
        <FilledTrack $disabled={disabled} style={filledStyle} />
      </FilledTrackWrapper>
      <Ticks show={showTicks} value={value} min={min} max={max} step={step} />
    </TrackRoot>
  )
}

const Root = styled.div<{ $disabled?: boolean; $focused?: boolean }>`
  height: 72px;
  position: relative;
  contain: layout style;
  opacity: ${props => (props.$disabled ? 'var(--theme-disabled-opacity)' : '1')};

  ${props => (props.$focused || props.$disabled ? 'outline: none;' : '')}
`

const SliderLabel = styled.div`
  ${labelLarge};
  position: absolute;
  top: 8px;
  left: 2px;

  color: var(--theme-on-surface-variant);
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
  top: ${54 - THUMB_HEIGHT_PX / 2}px;
  width: 100%;
  pointer-events: none;
  will-change: transform;
  transition: transform 150ms ${standardEasing};
`

const Thumb = styled.div<{ $disabled?: boolean }>`
  position: absolute;
  width: ${THUMB_WIDTH_PX}px;
  height: ${THUMB_HEIGHT_PX}px;
  left: ${THUMB_WIDTH_PX / -2}px;
  top: 2px;

  background-color: ${props =>
    props.$disabled ? 'var(--theme-on-surface)' : 'var(--theme-amber)'};
  border-radius: 50%;
  pointer-events: none;
  transition: background-color 200ms linear;
  z-index: 1;
`

const ClickableArea = styled.div<{ $disabled?: boolean }>`
  position: absolute;
  width: 100%;
  height: 32px;
  left: 0;
  bottom: 0;

  cursor: ${props => (props.$disabled ? 'auto' : 'pointer')};
`

const balloonVariants: Variants = {
  hidden: {
    scaleX: 0,
    scaleY: 0,
    opacity: 0,
  },
  visible: {
    scaleX: 1,
    scaleY: 1,
    opacity: 1,
  },
}

const balloonTransition: Transition = {
  scaleX: { type: 'spring', duration: 0.2 },
  scaleY: { type: 'spring', duration: 0.3 },
  opacity: { type: 'spring', duration: 0.2, bounce: 0 },
}

const Balloon = styled(m.div)`
  position: absolute;
  width: ${BALLOON_WIDTH_PX}px;
  height: ${BALLOON_HEIGHT_PX}px;
  top: -42px;
  left: ${BALLOON_WIDTH_PX / -2}px;

  display: flex;
  align-items: center;
  justify-content: center;

  background-color: var(--theme-amber);
  border-radius: 50%;
  color: var(--theme-on-amber);
  pointer-events: none;
  text-align: center;
  transform-origin: 50% 150%;
  will-change: transform, background-color, color;

  &::before {
    position: absolute;
    left: 0;
    top: 19px;

    border-radius: 16px;
    border-top: 16px solid var(--theme-amber);
    border-left: ${BALLOON_WIDTH_PX / 2}px solid transparent;
    border-right: ${BALLOON_WIDTH_PX / 2}px solid transparent;
    content: '';
    transition: border-top-color 250ms linear;
    will-change: border-top-color;
    z-index: 1;
  }
`

const BalloonText = styled.div`
  ${labelMedium};
  line-height: ${BALLOON_HEIGHT_PX}px;
  z-index: 2;
`

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

interface SliderProps {
  step?: number
  showTicks?: boolean
  tabIndex?: number
  min: number
  max: number
  value?: number | null
  onChange: (newValue: number) => void
  label?: string
  disabled?: boolean
  className?: string
  ref?: React.Ref<HTMLDivElement | null>
}

export function Slider({
  step = 1,
  showTicks = true,
  tabIndex = 0,
  min,
  max,
  value,
  label,
  disabled,
  className,
  onChange,
  ref,
}: SliderProps) {
  const [isFocused, setIsFocused] = useState(false)
  const [isClicked, setIsClicked] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [keyDownCount, setKeyDownCount] = useState(0)

  const id = useId()
  const trackAreaRef = useRef<HTMLDivElement>(null)
  const balloonRef = useRef<HTMLDivElement>(null)
  const sliderDimensionsRef = useRef<DOMRect | null>(null)

  const getClosestValue = useStableCallback((x: number) => {
    const percent = sliderDimensionsRef.current
      ? Math.max(
          0,
          Math.min(1, (x - sliderDimensionsRef.current.left) / sliderDimensionsRef.current.width),
        )
      : 0
    const exactValue = min + percent * (max - min)
    const formattedValue = Math.round((exactValue - min) / step) * step + min
    // Format to 3 digits after the decimal point; fixes issues when step is a decimal number
    const rounded = Math.round(formattedValue * 1000) / 1000
    return clamp(rounded, min, max)
  })

  const onMouseDown = useStableCallback((event: React.MouseEvent) => {
    if (disabled || !(event.buttons & MOUSE_LEFT)) {
      return
    }

    if (trackAreaRef.current) {
      sliderDimensionsRef.current = trackAreaRef.current.getBoundingClientRect()
    }
    setIsClicked(true)

    const newValue = getClosestValue(event.clientX)
    if (newValue !== value) {
      onChange(newValue)
    }
  })

  const onFocus = useStableCallback(() => {
    if (disabled) {
      return
    }
    setIsFocused(true)
  })

  const onBlur = useStableCallback(() => {
    if (disabled) {
      return
    }
    setIsFocused(false)
  })

  const onKeyDown = useStableCallback((event: React.KeyboardEvent) => {
    if (disabled) {
      return
    }

    let handled = false
    if (event.keyCode === LEFT) {
      handled = true
      if (value !== min) {
        setKeyDownCount(prev => prev + 1)
        onChange((value ?? min) - step)
      }
    } else if (event.keyCode === RIGHT) {
      handled = true
      if (value !== max) {
        setKeyDownCount(prev => prev + 1)
        onChange((value ?? min) + step)
      }
    } else if (event.keyCode === HOME) {
      handled = true
      if (value !== min) {
        onChange(min)
      }
    } else if (event.keyCode === END) {
      handled = true
      if (value !== max) {
        onChange(max)
      }
    }

    if (handled) {
      event.preventDefault()
      event.stopPropagation()
    }
  })

  const onKeyUp = useStableCallback((event: React.KeyboardEvent) => {
    if (disabled) {
      return
    }

    let handled = false
    if (event.keyCode === LEFT || event.keyCode === RIGHT) {
      handled = true
      setKeyDownCount(0)
    }

    if (handled) {
      event.preventDefault()
      event.stopPropagation()
    }
  })

  useEffect(() => {
    if (!isClicked && !isDragging) {
      return () => {}
    }

    const onMouseMove = (event: MouseEvent) => {
      if (disabled) {
        return
      }

      event.preventDefault()
      if (!isDragging) {
        setIsDragging(true)
      }

      const newValue = getClosestValue(event.clientX)
      if (newValue !== value) {
        onChange(newValue)
      }
    }

    const onMouseUp = (event: MouseEvent) => {
      if (disabled) {
        return
      }

      event.preventDefault()
      setIsClicked(false)
      setIsDragging(false)

      const newValue = getClosestValue(event.clientX)
      if (newValue !== value) {
        onChange(newValue)
      }
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)

    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [disabled, getClosestValue, isClicked, isDragging, onChange, value])

  const stepPercentage = (step / (max - min)) * 100
  const optionNum = ((value ?? min) - min) / step
  const thumbPosition = stepPercentage * optionNum
  const showBalloon = isFocused || isClicked

  let transitionDuration: number
  if (isDragging) {
    transitionDuration = 0
  } else if (keyDownCount > 1 /* Means the user is holding down a left/right key */) {
    transitionDuration = 30
  } else {
    transitionDuration = 150
  }

  return (
    <Root
      ref={ref}
      id={id}
      $focused={isFocused}
      $disabled={disabled}
      className={className}
      tabIndex={disabled ? -1 : tabIndex}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}>
      {label ? (
        <SliderLabel as='label' htmlFor={id}>
          {label}
        </SliderLabel>
      ) : null}
      <Track
        min={min}
        max={max}
        step={step}
        value={value ?? min}
        disabled={disabled}
        showTicks={showTicks && isClicked}
        transitionDuration={transitionDuration}
      />
      <OverflowClip>
        <ThumbContainer
          style={{
            transform: `translateX(${thumbPosition}%)`,
            transitionDuration: `${transitionDuration}ms`,
          }}>
          <Thumb $disabled={disabled} />
          <AnimatePresence>
            {showBalloon && (
              <Balloon
                ref={balloonRef}
                variants={balloonVariants}
                initial='hidden'
                animate='visible'
                exit='hidden'
                transition={balloonTransition}>
                <BalloonText>{value}</BalloonText>
              </Balloon>
            )}
          </AnimatePresence>
        </ThumbContainer>
      </OverflowClip>
      <ClickableArea ref={trackAreaRef} $disabled={disabled} onMouseDown={onMouseDown} />
    </Root>
  )
}
