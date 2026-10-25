import { rgba } from 'polished'
import styled, { css, keyframes } from 'styled-components'
import { decelerateEasing } from '../material/curve-constants'
import { amber60, blue40, blue95 } from '../styles/colors'

// NOTE: This component can render before our theme CSS variables are attached to the DOM, so it
// uses literal palette values rather than `var(--...)` custom properties.

/*
 * The indicator models a wheel spinning with a heavy weight on its rim. The five cells are
 * evenly-spaced points clustered across the bottom arc of the wheel, with the center of the
 * strip at the very bottom; the wide arc left over at the top is where the weight travels
 * unseen between passes. The weight accelerates through the bottom of its arc and labors up and
 * over the top, so a pass whips through the middle of the strip, lingers at the edges, and then
 * the strip rests while the weight crosses the top.
 *
 * Rather than hand-authoring each cell's flare, the weight's motion is simulated and every
 * cell's keyframes are sampled from it: a cell's brightness/size follow how close the weight is,
 * and the light's color follows how fast it's moving (hot amber at full speed at the bottom,
 * cooling to blue-white as it climbs). Deriving all five cells from the one motion keeps the
 * light reading as a single object — brightness hands off between neighbors exactly as the
 * weight travels, with no seams to tune by hand.
 */

/** How long one revolution of the wheel takes. */
const CYCLE_MS = 1600
/**
 * How much the weight's speed varies around the wheel, in (0, 1): 0 spins uniformly, and as it
 * approaches 1 the weight whips through the bottom and nearly stalls at the top. 0.78 gives
 * about a 3:1 ratio between the fastest and slowest points.
 */
const WHEEL_WEIGHT = 0.78
/** How far the weight's glow reaches around the rim, as the gaussian falloff width in degrees. */
const LIGHT_WIDTH_DEG = 40
/**
 * How far the weight's swell reaches around the rim, as the gaussian falloff width in degrees.
 * Broader than the light relative to the cell spacing: the heights of the cells form a smooth
 * wave that spans a few neighbors and rolls through the strip like a wake, while the focused
 * light rides its crest. Widths near the cell spacing or beyond keep adjacent heights
 * overlapping instead of one cell spiking alone; wider also stretches how early a cell starts
 * swelling ahead of the weight and how long it lingers after.
 */
const SWELL_WIDTH_DEG = 55
/**
 * How far apart neighboring cells sit on the rim, in degrees. The strip spans two spacings to
 * either side of the bottom of the wheel, so smaller spacings cluster the cells lower on the
 * wheel and leave a wider empty arc at the top — which keeps the swell of the last cell fully
 * settled before the first cell begins to grow, giving the strip a still moment between passes.
 */
const CELL_SPACING_DEG = 56
/** Where each cell sits on the rim, in degrees, with 0 at the bottom of the wheel. */
const CELL_ANGLES_DEG = [-2, -1, 0, 1, 2].map(i => i * CELL_SPACING_DEG)
/** How many keyframe stops to emit per cell. */
const KEYFRAME_SAMPLES = 80

const OMEGA_MIN = Math.sqrt(1 - WHEEL_WEIGHT)
const OMEGA_MAX = Math.sqrt(1 + WHEEL_WEIGHT)

function omegaAt(thetaDeg: number): number {
  return Math.sqrt(1 + WHEEL_WEIGHT * Math.cos((thetaDeg * Math.PI) / 180))
}

/**
 * The weight's angle over one revolution, as [time fraction of the cycle, angle] pairs. Time 0 is
 * the weight cresting the top of the wheel (the middle of the rest between passes), so a freshly
 * mounted indicator begins with the weight swelling into the first cell.
 */
const MOTION_TABLE: ReadonlyArray<{ tFrac: number; thetaDeg: number }> = (() => {
  const STEPS = 1440
  const samples: Array<{ tFrac: number; thetaDeg: number }> = [{ tFrac: 0, thetaDeg: -180 }]
  let t = 0
  for (let i = 1; i <= STEPS; i++) {
    const thetaDeg = -180 + (360 * i) / STEPS
    // Constant angle steps mean each step's duration is inversely proportional to angular speed
    // (evaluated mid-step)
    t += 1 / omegaAt(thetaDeg - 180 / STEPS)
    samples.push({ tFrac: t, thetaDeg })
  }
  for (const s of samples) {
    s.tFrac /= t
  }
  return samples
})()

function thetaAtFraction(tFrac: number): number {
  for (let i = 1; i < MOTION_TABLE.length; i++) {
    const prev = MOTION_TABLE[i - 1]
    const next = MOTION_TABLE[i]
    if (tFrac <= next.tFrac) {
      const span = next.tFrac - prev.tFrac
      const lerp = span > 0 ? (tFrac - prev.tFrac) / span : 0
      return prev.thetaDeg + (next.thetaDeg - prev.thetaDeg) * lerp
    }
  }
  return MOTION_TABLE[MOTION_TABLE.length - 1].thetaDeg
}

function angularDistanceDeg(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180)
}

const CELL_SKEW = 'skewX(-14deg)'
/** The blur of the glow at full light. */
const GLOW_BLUR_PX = 12
/** The opacity of the glow at full light. */
const GLOW_ALPHA = 0.7

/**
 * A cell's flare, expressed purely as transforms and layer opacities so the whole indicator runs
 * on the compositor. The cell's lit color is `mix(light, lightColor, blue40)` with `lightColor`
 * itself a mix of amber and blue-white; that's reproduced exactly by stacking a blue-white layer
 * and then an amber layer over the blue40 cell, each at the opacity that yields the same weights.
 * The glow is a pair of fixed-blur shadows (one per light color) faded in by the same weights.
 */
interface CellFlare {
  swell: ReturnType<typeof keyframes>
  coolLight: ReturnType<typeof keyframes>
  hotLight: ReturnType<typeof keyframes>
  coolGlow: ReturnType<typeof keyframes>
  hotGlow: ReturnType<typeof keyframes>
}

function buildCellFlare(cellAngleDeg: number): CellFlare {
  const stops: Record<keyof CellFlare, string[]> = {
    swell: [],
    coolLight: [],
    hotLight: [],
    coolGlow: [],
    hotGlow: [],
  }
  const opacityStop = (percent: string, opacity: number) =>
    `${percent} { opacity: ${opacity.toFixed(3)}; }`

  for (let k = 0; k <= KEYFRAME_SAMPLES; k++) {
    const tFrac = k / KEYFRAME_SAMPLES
    const percent = `${(tFrac * 100).toFixed(2)}%`
    const thetaDeg = thetaAtFraction(tFrac)
    const distDeg = angularDistanceDeg(thetaDeg, cellAngleDeg)
    // 0..1: how strongly the weight's light hits this cell / how much its wake swells it
    const light = Math.exp(-((distDeg / LIGHT_WIDTH_DEG) ** 2))
    const swell = Math.exp(-((distDeg / SWELL_WIDTH_DEG) ** 2))
    // 0..1: how fast the weight is moving
    const speed = (omegaAt(thetaDeg) - OMEGA_MIN) / (OMEGA_MAX - OMEGA_MIN)
    // 0..1: how much of the light is amber. The light runs hot when the weight is both fast and
    // near; squaring the speed keeps the amber for the genuinely quick part of the arc
    const heat = speed * speed * light

    // Amber's share of the final color is light * heat, and the blue-white layer beneath it
    // needs light * (1 - heat) to survive being partially covered by the amber
    const hotOpacity = light * heat
    const coolOpacity = hotOpacity < 1 ? (light * (1 - heat)) / (1 - hotOpacity) : 0

    stops.swell.push(
      `${percent} { transform: ${CELL_SKEW} scaleY(${(1 + 0.35 * swell).toFixed(3)}); }`,
    )
    stops.coolLight.push(opacityStop(percent, coolOpacity))
    stops.hotLight.push(opacityStop(percent, hotOpacity))
    stops.coolGlow.push(opacityStop(percent, light * (1 - heat)))
    stops.hotGlow.push(opacityStop(percent, light * heat))
  }

  return {
    swell: keyframes`${stops.swell.join('\n')}`,
    coolLight: keyframes`${stops.coolLight.join('\n')}`,
    hotLight: keyframes`${stops.hotLight.join('\n')}`,
    coolGlow: keyframes`${stops.coolGlow.join('\n')}`,
    hotGlow: keyframes`${stops.hotGlow.join('\n')}`,
  }
}

const CELL_FLARES = CELL_ANGLES_DEG.map(buildCellFlare)

const gentlePulse = keyframes`
  0%, 100% {
    opacity: 0.5;
  }

  50% {
    opacity: 1;
  }
`

const fadeIn = keyframes`
  from {
    opacity: 0;
  }

  to {
    opacity: 1;
  }
`

const LOADING_SHOW_DELAY_MS = 750
const LOADING_FADE_IN_MS = 450

const delayedShowCss = css`
  opacity: 0;
  animation: ${LOADING_FADE_IN_MS}ms ${decelerateEasing} ${LOADING_SHOW_DELAY_MS}ms forwards
    ${fadeIn};
`

const Root = styled.div<{ $showImmediately?: boolean }>`
  display: flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 4px 8px;

  ${props => (!props.$showImmediately ? delayedShowCss : '')};
`

interface CellProps {
  /** Which cell of the strip this is (its index into the generated keyframes). */
  $index: number
  /** How long to delay the animation for, in milliseconds. */
  $delayMs: number
}

const flareTiming = css<CellProps>`
  animation-duration: ${CYCLE_MS}ms;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
  animation-delay: ${props => props.$delayMs}ms;
`

const Cell = styled.div<CellProps>`
  position: relative;
  width: 9px;
  height: 16px;

  background-color: ${blue40};
  border-radius: 2px;
  transform: ${CELL_SKEW};

  animation-name: ${props => CELL_FLARES[props.$index].swell};
  ${flareTiming};

  @media (prefers-reduced-motion: reduce) {
    animation-name: ${gentlePulse};
    animation-duration: 2500ms;
    animation-timing-function: ease-in-out;
  }
`

const CellLayer = styled.div<CellProps & { $layer: Exclude<keyof CellFlare, 'swell'> }>`
  position: absolute;
  inset: 0;
  border-radius: inherit;
  opacity: 0;

  ${props => {
    switch (props.$layer) {
      case 'coolLight':
        return `background-color: ${blue95};`
      case 'hotLight':
        return `background-color: ${amber60};`
      case 'coolGlow':
        return `box-shadow: 0 0 ${GLOW_BLUR_PX}px ${rgba(blue95, GLOW_ALPHA)};`
      case 'hotGlow':
        return `box-shadow: 0 0 ${GLOW_BLUR_PX}px ${rgba(amber60, GLOW_ALPHA)};`
      default:
        return props.$layer satisfies never
    }
  }}

  animation-name: ${props => CELL_FLARES[props.$index][props.$layer]};
  ${flareTiming};

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`

interface DotsIndicatorProps {
  /**
   * Whether or not to show the progress indicator immediately. If false, there will be a slight
   * delay before actually showing the indicator, which tends to make UIs feel more responsive if
   * they only have a very small delay before loading has completed.
   */
  showImmediately?: boolean

  /** A class string to add to the root element. */
  className?: string
}

/**
 * Renders the strip of animated cells. When `delayed`, the animation waits out
 * `LOADING_SHOW_DELAY_MS`, so the wheel's first pass starts just as a delayed reveal fades in
 * rather than being caught mid-revolution. `fadeRoot` controls whether this element hides/fades
 * itself — a delayed containing area does its own fading and only needs the animation start to
 * match it.
 */
function CellStrip({
  delayed,
  fadeRoot,
  className,
}: {
  delayed: boolean
  fadeRoot: boolean
  className?: string
}) {
  const delayMs = delayed ? LOADING_SHOW_DELAY_MS : 0
  return (
    <Root className={className} $showImmediately={!fadeRoot}>
      {CELL_FLARES.map((_, i) => (
        <Cell key={i} $index={i} $delayMs={delayMs}>
          <CellLayer $layer='coolGlow' $index={i} $delayMs={delayMs} />
          <CellLayer $layer='hotGlow' $index={i} $delayMs={delayMs} />
          <CellLayer $layer='coolLight' $index={i} $delayMs={delayMs} />
          <CellLayer $layer='hotLight' $index={i} $delayMs={delayMs} />
        </Cell>
      ))}
    </Root>
  )
}

export function DotsIndicator({ showImmediately = false, className }: DotsIndicatorProps) {
  return <CellStrip className={className} delayed={!showImmediately} fadeRoot={!showImmediately} />
}

export default DotsIndicator

const LoadingArea = styled.div<{ $showImmediately?: boolean }>`
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  min-height: 56px;
  padding: 16px 0;

  ${props => (!props.$showImmediately ? delayedShowCss : '')};
`

export function LoadingDotsArea({ showImmediately = false, className }: DotsIndicatorProps) {
  return (
    <LoadingArea className={className} $showImmediately={showImmediately}>
      <CellStrip delayed={!showImmediately} fadeRoot={false} />
    </LoadingArea>
  )
}
