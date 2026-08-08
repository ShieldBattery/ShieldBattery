import keycode from 'keycode'
import * as React from 'react'
import { useId, useRef, useState } from 'react'
import styled from 'styled-components'
import { useStableCallback } from '../react/state-hooks'
import { labelLarge, labelMedium } from '../styles/typography'
import { standardEasing } from './curve-constants'

const LEFT = keycode('left')
const RIGHT = keycode('right')
const HOME = keycode('home')
const END = keycode('end')

const THUMB_SIZE_PX = 20

/** Which end of the range a thumb controls. */
type Handle = 'low' | 'high'

const Root = styled.div<{ $disabled?: boolean }>`
  opacity: ${props => (props.$disabled ? 'var(--theme-disabled-opacity)' : '1')};
  contain: layout style;
`

const Header = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 4px;
`

const Label = styled.div`
  ${labelLarge};
  color: var(--theme-on-surface-variant);
`

/**
 * The selected range, shown persistently rather than in a balloon on drag. A filter's current
 * bounds are the thing you keep referring back to while reading what it filtered, so they can't
 * only exist while a thumb is held.
 */
const Value = styled.div`
  ${labelMedium};
  color: var(--theme-on-surface);
  font-variant-numeric: tabular-nums;
`

/**
 * Sized to the thumb rather than the track so the thumbs at either extreme sit inside the
 * component's own box; the track is inset by half a thumb to line its ends up with them.
 */
const TrackArea = styled.div<{ $disabled?: boolean }>`
  position: relative;
  height: ${THUMB_SIZE_PX + 12}px;
  padding: 0 ${THUMB_SIZE_PX / 2}px;
  cursor: ${props => (props.$disabled ? 'auto' : 'pointer')};
  touch-action: none;
`

const TrackRail = styled.div`
  position: absolute;
  top: 50%;
  left: ${THUMB_SIZE_PX / 2}px;
  right: ${THUMB_SIZE_PX / 2}px;
  height: 4px;
  transform: translateY(-50%);

  border-radius: 4px;
  background-color: rgb(from var(--theme-on-surface) r g b / 0.12);
`

const TrackFill = styled.div<{ $disabled?: boolean }>`
  position: absolute;
  top: 0;
  height: 100%;
  border-radius: 4px;
  background-color: ${props =>
    props.$disabled ? 'var(--theme-on-surface)' : 'var(--theme-amber)'};
  transition:
    left 150ms ${standardEasing},
    right 150ms ${standardEasing};
`

const Thumb = styled.div<{ $disabled?: boolean; $dragging: boolean }>`
  position: absolute;
  top: 50%;
  width: ${THUMB_SIZE_PX}px;
  height: ${THUMB_SIZE_PX}px;
  margin-left: ${THUMB_SIZE_PX / -2}px;

  background-color: ${props =>
    props.$disabled ? 'var(--theme-on-surface)' : 'var(--theme-amber)'};
  border-radius: 50%;
  transform: translateY(-50%);
  transition: ${props => (props.$dragging ? 'none' : `left 150ms ${standardEasing}`)};

  &:focus-visible {
    outline: 2px solid var(--theme-amber);
    outline-offset: 3px;
  }
`

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export interface RangeSliderProps {
  min: number
  max: number
  step?: number
  /**
   * Smallest gap the two thumbs may be apart. Defaults to 0, which lets them meet.
   *
   * Set it to one step where a zero-width range would be meaningless: the thumbs then stack into
   * what looks like a single broken control, and the filled track collapses to nothing, so the
   * slider reads as disabled rather than as narrowed all the way down.
   */
  minRange?: number
  /** The selected range as `[low, high]`. Never crosses, and never closer than `minRange`. */
  value: readonly [number, number]
  onChange: (value: [number, number]) => void
  label?: string
  /**
   * What each thumb is called to a screen reader. Props rather than strings baked in here,
   * because this lives in `material/` and has no business reaching for the translation catalog.
   */
  lowLabel?: string
  highLabel?: string
  /** Renders a bound for display — e.g. turning a clamped top band into `2400+`. */
  formatValue?: (value: number) => string
  disabled?: boolean
  className?: string
}

/**
 * A slider with two thumbs, selecting a range rather than a value.
 *
 * Separate from `Slider` rather than a mode of it: nearly everything that makes that component
 * long — the balloon, the tick marks, the single focusable root — is either shaped around having
 * exactly one value or is deliberately not wanted here. Two thumbs need two focus targets to be
 * usable from a keyboard at all, which is the part a `values: number[]` prop couldn't paper over.
 */
export function RangeSlider({
  min,
  max,
  step = 1,
  minRange = 0,
  value,
  onChange,
  label,
  lowLabel = 'Minimum',
  highLabel = 'Maximum',
  formatValue = String,
  disabled,
  className,
}: RangeSliderProps) {
  const id = useId()
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<Handle>()

  const [low, high] = value
  const span = max - min

  const valueAt = useStableCallback((clientX: number) => {
    const track = trackRef.current
    if (!track) return min
    const rect = track.getBoundingClientRect()
    // The usable width excludes the half-thumb inset at each end, so dragging to the very edge
    // reaches the bound instead of stopping short of it.
    const usable = rect.width - THUMB_SIZE_PX
    const percent = usable > 0 ? clamp((clientX - rect.left - THUMB_SIZE_PX / 2) / usable, 0, 1) : 0
    return clamp(Math.round((min + percent * span) / step) * step, min, max)
  })

  const move = useStableCallback((handle: Handle, next: number) => {
    // Thumbs stop `minRange` short of each other rather than swapping roles: a handle that changed
    // which end it controlled mid-drag would leave the pointer dragging something the user didn't
    // grab. Each is also kept inside the track, so pushing one against the other can't drag the
    // pair past a bound.
    const updated: [number, number] =
      handle === 'low'
        ? [clamp(next, min, Math.min(high - minRange, max - minRange)), high]
        : [low, clamp(next, Math.max(low + minRange, min + minRange), max)]
    if (updated[0] !== low || updated[1] !== high) {
      onChange(updated)
    }
  })

  const onPointerDown = useStableCallback((event: React.PointerEvent) => {
    if (disabled) return
    const next = valueAt(event.clientX)
    // Whichever thumb is nearer to the press; ties go to the low one only when it isn't already
    // pinned at the maximum, which would otherwise make the top of the track unreachable.
    const handle: Handle =
      Math.abs(next - low) < Math.abs(next - high) || (next === low && low < max) ? 'low' : 'high'
    setDragging(handle)
    event.currentTarget.setPointerCapture(event.pointerId)
    move(handle, next)
  })

  const onPointerMove = useStableCallback((event: React.PointerEvent) => {
    if (disabled || !dragging) return
    move(dragging, valueAt(event.clientX))
  })

  const endDrag = useStableCallback((event: React.PointerEvent) => {
    if (!dragging) return
    setDragging(undefined)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  })

  const onKeyDown = (handle: Handle) => (event: React.KeyboardEvent) => {
    if (disabled) return
    const current = handle === 'low' ? low : high
    let next: number | undefined
    if (event.keyCode === LEFT) next = current - step
    else if (event.keyCode === RIGHT) next = current + step
    else if (event.keyCode === HOME) next = min
    else if (event.keyCode === END) next = max

    if (next !== undefined) {
      event.preventDefault()
      event.stopPropagation()
      move(handle, next)
    }
  }

  const percentOf = (v: number) => (span > 0 ? ((v - min) / span) * 100 : 0)
  const lowPercent = percentOf(low)
  const highPercent = percentOf(high)

  const thumb = (handle: Handle, at: number, percent: number) => {
    const handleLabel = handle === 'low' ? lowLabel : highLabel
    return (
      <Thumb
        role='slider'
        tabIndex={disabled ? -1 : 0}
        aria-label={label ? `${label}, ${handleLabel}` : handleLabel}
        aria-valuemin={handle === 'low' ? min : low}
        aria-valuemax={handle === 'low' ? high : max}
        aria-valuenow={at}
        aria-valuetext={formatValue(at)}
        aria-disabled={disabled}
        $disabled={disabled}
        $dragging={dragging === handle}
        style={{
          left: `calc(${THUMB_SIZE_PX / 2}px + ${percent}% - ${(percent / 100) * THUMB_SIZE_PX}px)`,
        }}
        onKeyDown={onKeyDown(handle)}
      />
    )
  }

  return (
    <Root className={className} $disabled={disabled} id={id}>
      {label ? (
        <Header>
          <Label>{label}</Label>
          <Value>
            {formatValue(low)} &ndash; {formatValue(high)}
          </Value>
        </Header>
      ) : undefined}
      <TrackArea
        ref={trackRef}
        $disabled={disabled}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}>
        <TrackRail>
          <TrackFill
            $disabled={disabled}
            style={{ left: `${lowPercent}%`, right: `${100 - highPercent}%` }}
          />
        </TrackRail>
        {thumb('low', low, lowPercent)}
        {thumb('high', high, highPercent)}
      </TrackArea>
    </Root>
  )
}
