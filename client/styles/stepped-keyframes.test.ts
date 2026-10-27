import { describe, expect, test } from 'vitest'
import { easeInOut, steppedEaseInOut } from './stepped-keyframes'

function parse(rule: string) {
  return rule.split('\n').map(line => {
    const match =
      /^([\d.]+)% \{ v: ([-\d.]+); (?:animation-timing-function: steps\((\d+)\); )?\}$/.exec(line)
    expect(match).not.toBeNull()
    return { at: Number(match![1]), value: Number(match![2]), steps: Number(match![3] ?? 0) }
  })
}

describe('client/styles/stepped-keyframes', () => {
  test('easeInOut matches the curve at its ends and middle', () => {
    expect(easeInOut(0)).toBeCloseTo(0, 6)
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 6)
    expect(easeInOut(1)).toBeCloseTo(1, 6)
    expect(easeInOut(0.25)).toBeLessThan(0.25)
  })

  test('steps at the given rate, with every keyframe on a step boundary', () => {
    const durationMs = 26_000
    const stepMs = 50
    const frames = parse(
      steppedEaseInOut(
        durationMs,
        stepMs,
        [
          { at: 0, values: [0] },
          { at: 0.55, values: [10] },
          { at: 1, values: [-4] },
        ],
        ([v]) => `v: ${v};`,
      ),
    )

    expect(frames.reduce((sum, f) => sum + f.steps, 0)).toBe(durationMs / stepMs)
    for (const frame of frames) {
      const ms = (frame.at / 100) * durationMs
      expect(Math.abs(ms / stepMs - Math.round(ms / stepMs))).toBeLessThan(0.01)
      expect(frame.steps).toBeLessThanOrEqual(10)
    }
    expect(frames[0]).toMatchObject({ at: 0, value: 0 })
    expect(frames.find(f => f.at === 55)?.value).toBe(10)
    expect(frames.at(-1)).toMatchObject({ at: 100, value: -4, steps: 0 })
  })
})
