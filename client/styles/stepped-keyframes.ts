/** A stop in a stepped animation: where it falls (0 to 1) and the numbers it renders. */
export interface SteppedStop {
  at: number
  values: readonly number[]
}

/**
 * The most steps one generated keyframe interval covers. Values are interpolated linearly within an
 * interval, so shorter intervals follow the easing curve more closely, at the cost of a longer rule.
 */
const MAX_STEPS_PER_INTERVAL = 10

/**
 * Builds the body of a `@keyframes` rule that eases between `stops` the way `ease-in-out` does on
 * each interval between them, but only changes every `stepMs`. A running animation makes the
 * browser draw a new frame every display refresh, even when nothing visibly changes; one that holds
 * its values between steps only makes it draw once per step.
 *
 * Each generated keyframe carries its own `steps()` timing function, so the animation using this
 * must not set `animation-timing-function` itself.
 *
 * Animations whose steps fall at the same moments share the frames they cause. To keep several
 * animations that run together at a single rate, give them the same `stepMs`, and make their
 * durations, delays, and the times of their stops all whole multiples of it.
 */
export function steppedEaseInOut(
  durationMs: number,
  stepMs: number,
  stops: readonly SteppedStop[],
  render: (values: readonly number[]) => string,
): string {
  const lines: string[] = []
  for (let i = 0; i < stops.length - 1; i++) {
    const from = stops[i]
    const to = stops[i + 1]
    const startMs = from.at * durationMs
    const totalSteps = Math.round(((to.at - from.at) * durationMs) / stepMs)
    const intervals = Math.ceil(totalSteps / MAX_STEPS_PER_INTERVAL)
    let done = 0
    for (let j = 0; j < intervals; j++) {
      const steps = Math.round(((j + 1) * totalSteps) / intervals) - done
      const progress = easeInOut(done / totalSteps)
      const values =
        done === 0 ? from.values : from.values.map((v, k) => v + (to.values[k] - v) * progress)
      const at = (startMs + done * stepMs) / durationMs
      lines.push(`${percent(at)} { ${render(values)} animation-timing-function: steps(${steps}); }`)
      done += steps
    }
  }
  const last = stops[stops.length - 1]
  lines.push(`${percent(last.at)} { ${render(last.values)} }`)
  return lines.join('\n')
}

function percent(at: number): string {
  return `${Number((at * 100).toFixed(5))}%`
}

/** `ease-in-out`, i.e. `cubic-bezier(0.42, 0, 0.58, 1)`, at time `x` (0 to 1). */
export function easeInOut(x: number): number {
  const bezier = (t: number, p1: number, p2: number) =>
    3 * (1 - t) * (1 - t) * t * p1 + 3 * (1 - t) * t * t * p2 + t * t * t
  let low = 0
  let high = 1
  for (let i = 0; i < 32; i++) {
    const mid = (low + high) / 2
    if (bezier(mid, 0.42, 0.58) < x) {
      low = mid
    } else {
      high = mid
    }
  }
  return bezier((low + high) / 2, 0, 1)
}
