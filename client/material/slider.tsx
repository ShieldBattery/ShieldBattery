import * as React from 'react'
import { useId } from 'react'
import styled, { css } from 'styled-components'
import { labelLarge } from '../styles/typography'
import { standardEasing } from './curve-constants'

/** Sliders with at most this many stops draw a dot (and optionally a label) at each one. */
const MAX_INDICATED_STOPS = 11

/**
 * Distance from each end of the track to the center of the handle when it sits at that end. The
 * native input's (invisible) thumb is twice this wide, so the browser maps pointer positions to
 * values along exactly the span the handle is drawn on.
 */
const INSET_PX = 8
/** Distance from the center of the handle to the track segments on either side of it. */
const HANDLE_GAP_PX = 8
const HANDLE_WIDTH_PX = 4
const HANDLE_PRESSED_WIDTH_PX = 2
const STOP_DOT_PX = 4
const STOP_LABEL_WIDTH_PX = 40
const STOP_LABEL_ROW_PX = 24

export type SliderSize = 'normal' | 'compact'

const SIZES: Record<
  SliderSize,
  { area: number; track: number; trackRadius: number; handle: number; halo: number }
> = {
  normal: { area: 44, track: 16, trackRadius: 8, handle: 40, halo: 40 },
  compact: { area: 32, track: 8, trackRadius: 4, handle: 24, halo: 32 },
}

const positionDuration = '250ms'

/**
 * A CSS length placing something at `fraction` (0 to 1, as a number or CSS expression) of the way
 * along a slider, measured to the handle's center line. `100%` must resolve to the slider's width,
 * so this can also line up labels in a same-width container beside the slider.
 */
export function sliderPosition(fraction: number | string, offsetPx = 0) {
  return `calc(${INSET_PX + offsetPx}px + (100% - ${INSET_PX * 2}px) * ${fraction})`
}

const Root = styled.div<{ $size: SliderSize; $disabled?: boolean }>`
  width: 100%;
  padding-block: ${props => (props.$size === 'normal' ? '8px' : '0')};
  opacity: ${props => (props.$disabled ? 'var(--theme-disabled-opacity)' : '1')};
`

const LabelRow = styled.div`
  min-height: 20px;
  margin-bottom: 4px;

  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
`

const Label = styled.label`
  ${labelLarge};
  color: var(--theme-on-surface-variant);
`

const Readout = styled.div`
  ${labelLarge};
  color: var(--theme-on-surface);
  font-variant-numeric: tabular-nums;
`

const Control = styled.div<{ $size: SliderSize; $hasStopLabels: boolean }>`
  --_area: ${props => SIZES[props.$size].area}px;
  --_track: ${props => SIZES[props.$size].track}px;
  --_track-radius: ${props => SIZES[props.$size].trackRadius}px;
  --_handle: ${props => SIZES[props.$size].handle}px;
  --_halo: ${props => SIZES[props.$size].halo}px;

  position: relative;
  width: 100%;
  height: calc(var(--_area) + ${props => (props.$hasStopLabels ? STOP_LABEL_ROW_PX : 0)}px);
`

const Input = styled.input<{ $height: number }>`
  appearance: none;
  position: absolute;
  inset: 0;
  z-index: 1;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;

  background: transparent;
  cursor: pointer;
  opacity: 0;

  &:disabled {
    cursor: auto;
  }

  &::-webkit-slider-runnable-track {
    height: 100%;
    border: 0;
    background: transparent;
  }

  &::-webkit-slider-thumb {
    appearance: none;
    width: ${INSET_PX * 2}px;
    height: ${props => props.$height}px;
    border: 0;
    background: transparent;
  }
`

/** Transitions for things that follow the value, frozen while dragging a continuous slider. */
const followsValue = (properties: string, continuous: boolean) => css`
  transition-property: ${properties};
  transition-duration: ${positionDuration};
  transition-timing-function: ${standardEasing};

  ${
    continuous
      ? css`
          ${Input}:active ~ & {
            transition-duration: 0ms;
          }
        `
      : ''
  }
`

const trackSegment = css`
  position: absolute;
  top: calc((var(--_area) - var(--_track)) / 2);
  height: var(--_track);
  pointer-events: none;
`

const ActiveTrack = styled.div<{ $continuous: boolean }>`
  ${trackSegment};
  ${props => followsValue('width', props.$continuous)};
  left: 0;
  width: calc((100% - ${INSET_PX * 2}px) * var(--_fraction) + ${INSET_PX - HANDLE_GAP_PX}px);
  border-radius: var(--_track-radius) 2px 2px var(--_track-radius);
  background-color: var(--theme-amber);
`

const InactiveTrack = styled.div<{ $continuous: boolean }>`
  ${trackSegment};
  ${props => followsValue('left', props.$continuous)};
  left: ${sliderPosition('var(--_fraction)', HANDLE_GAP_PX)};
  right: 0;
  border-radius: 2px var(--_track-radius) var(--_track-radius) 2px;
  background-color: var(--theme-grey-blue-container);
`

const StopDot = styled.div<{ $active: boolean; $current: boolean }>`
  position: absolute;
  top: calc((var(--_area) - ${STOP_DOT_PX}px) / 2);
  width: ${STOP_DOT_PX}px;
  height: ${STOP_DOT_PX}px;
  margin-left: ${-STOP_DOT_PX / 2}px;

  border-radius: 50%;
  background-color: ${props =>
    props.$active ? 'var(--theme-on-amber)' : 'var(--color-grey-blue80)'};
  opacity: ${props => (props.$current ? 0 : 1)};
  pointer-events: none;
`

const StopLabel = styled.div<{ $current: boolean }>`
  ${labelLarge};
  position: absolute;
  top: calc(var(--_area) + 2px);
  width: ${STOP_LABEL_WIDTH_PX}px;
  margin-left: ${-STOP_LABEL_WIDTH_PX / 2}px;

  color: ${props => (props.$current ? 'var(--theme-amber)' : 'var(--theme-on-surface-variant)')};
  font-weight: ${props => (props.$current ? 600 : 500)};
  pointer-events: none;
  text-align: center;
`

const Halo = styled.div<{ $continuous: boolean }>`
  ${props => followsValue('left, opacity, background-color', props.$continuous)};
  position: absolute;
  top: calc((var(--_area) - var(--_halo)) / 2);
  left: ${sliderPosition('var(--_fraction)')};
  width: var(--_halo);
  height: var(--_halo);
  transform: translateX(-50%);

  border-radius: 50%;
  background-color: rgb(from var(--theme-amber) r g b / 0.08);
  opacity: 0;
  pointer-events: none;

  ${Input}:hover:enabled ~ & {
    opacity: 1;
  }

  ${Input}:active:enabled ~ & {
    opacity: 1;
    background-color: rgb(from var(--theme-amber) r g b / 0.12);
  }
`

const Handle = styled.div<{ $continuous: boolean }>`
  ${props => followsValue('left, width', props.$continuous)};
  position: absolute;
  top: calc((var(--_area) - var(--_handle)) / 2);
  left: ${sliderPosition('var(--_fraction)')};
  width: ${HANDLE_WIDTH_PX}px;
  height: var(--_handle);
  transform: translateX(-50%);

  border-radius: 2px;
  background-color: var(--theme-amber);
  pointer-events: none;

  ${Input}:active:enabled ~ & {
    width: ${HANDLE_PRESSED_WIDTH_PX}px;
  }

  ${Input}:focus-visible ~ & {
    outline: 3px solid var(--theme-grey-blue);
    outline-offset: 2px;
  }
`

function defaultFormatValue(value: number) {
  return String(value)
}

interface SliderProps {
  min: number
  max: number
  step?: number
  value?: number | null
  onChange: (newValue: number) => void
  /** Visible label, shown above the track. */
  label?: string
  /**
   * Formats a value for display, both for the readout next to the label and for the labels under
   * each stop. Also used as the accessible value text unless `formatValueText` is provided.
   */
  formatValue?: (value: number) => string
  /** Formats a value for assistive technology, e.g. to call out a recommended value. */
  formatValueText?: (value: number) => string
  /**
   * Whether to label each stop with its value. Only applies to sliders with few enough stops to
   * indicate them individually; others show the value next to the label instead.
   */
  showStopLabels?: boolean
  size?: SliderSize
  disabled?: boolean
  tabIndex?: number
  ariaLabel?: string
  ariaLabelledBy?: string
  ariaDescribedBy?: string
  className?: string
  ref?: React.Ref<HTMLDivElement | null>
}

/**
 * A slider for picking a number from a range. Sliders with only a few stops mark (and by default
 * label) each one; sliders with many stops behave continuously and show the current value next to
 * their label.
 *
 * Interaction is handled by a native range input layered invisibly over the drawn track, which
 * provides pointer, keyboard, and accessibility behavior.
 */
export function Slider({
  min,
  max,
  step = 1,
  value,
  onChange,
  label,
  formatValue = defaultFormatValue,
  formatValueText,
  showStopLabels = true,
  size = 'normal',
  disabled,
  tabIndex = 0,
  ariaLabel,
  ariaLabelledBy,
  ariaDescribedBy,
  className,
  ref,
}: SliderProps) {
  const inputId = useId()
  const currentValue = value ?? min
  const fraction = max > min ? (currentValue - min) / (max - min) : 0

  const numStops = Math.round((max - min) / step) + 1
  const continuous = numStops > MAX_INDICATED_STOPS
  const hasStopLabels = !continuous && showStopLabels
  const currentStop = Math.round((currentValue - min) / step)

  const stops: React.ReactNode[] = []
  if (!continuous) {
    for (let i = 0; i < numStops; i++) {
      const left = sliderPosition(numStops > 1 ? i / (numStops - 1) : 0)
      stops.push(
        <StopDot
          key={`dot-${i}`}
          $active={i < currentStop}
          $current={i === currentStop}
          style={{ left }}
        />,
      )
      if (hasStopLabels) {
        // Rounded to avoid floating point noise from fractional steps (e.g. 0.30000000000000004)
        const stopValue = Math.round((min + i * step) * 1000) / 1000
        stops.push(
          <StopLabel key={`label-${i}`} $current={i === currentStop} style={{ left }}>
            {formatValue(stopValue)}
          </StopLabel>,
        )
      }
    }
  }

  return (
    <Root ref={ref} className={className} $size={size} $disabled={disabled}>
      {label ? (
        <LabelRow>
          <Label htmlFor={inputId}>{label}</Label>
          {hasStopLabels ? null : <Readout aria-hidden={true}>{formatValue(currentValue)}</Readout>}
        </LabelRow>
      ) : null}
      <Control
        $size={size}
        $hasStopLabels={hasStopLabels}
        style={{ '--_fraction': fraction } as React.CSSProperties}>
        <Input
          id={inputId}
          type='range'
          $height={SIZES[size].area + (hasStopLabels ? STOP_LABEL_ROW_PX : 0)}
          min={min}
          max={max}
          step={step}
          value={currentValue}
          onChange={event => onChange(Number(event.target.value))}
          disabled={disabled}
          tabIndex={tabIndex}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-describedby={ariaDescribedBy}
          aria-valuetext={formatValueText?.(currentValue) ?? formatValue(currentValue)}
        />
        <ActiveTrack $continuous={continuous} />
        <InactiveTrack $continuous={continuous} />
        {stops}
        <Halo $continuous={continuous} />
        <Handle $continuous={continuous} />
      </Control>
    </Root>
  )
}
