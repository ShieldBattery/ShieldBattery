import { describe, expect, test, vi } from 'vitest'
import { EIGHT_BALL_ANSWERS, ROLL_DEFAULT_MAX, ROLL_MAX_MAX } from '../../../common/rolled-outcomes'
import { QUOTE_UNITS, UNIT_QUOTES } from '../../../common/unit-quotes'
import { rollOutcome } from './roll-outcome'

describe('messaging/roll-outcome', () => {
  /** A stand-in generator that answers with `value` and records the bounds it was asked for. */
  function fakeRandomInt(value: number) {
    return vi.fn((_min: number, _max: number) => value)
  }

  describe('roll', () => {
    test('picks a value over the whole inclusive range', () => {
      const randomInt = fakeRandomInt(4)

      expect(rollOutcome({ kind: 'roll', max: 6 }, randomInt)).toEqual({
        kind: 'roll',
        max: 6,
        value: 4,
      })
      // The upper bound is exclusive, so rolling 1 to 6 asks for [1, 7)
      expect(randomInt).toHaveBeenCalledWith(1, 7)
    })

    test('rolls 1 to the default max when the request names none', () => {
      const randomInt = fakeRandomInt(57)

      expect(rollOutcome({ kind: 'roll' }, randomInt)).toEqual({
        kind: 'roll',
        max: ROLL_DEFAULT_MAX,
        value: 57,
      })
      expect(randomInt).toHaveBeenCalledWith(1, ROLL_DEFAULT_MAX + 1)
    })

    test('can reach both ends of the range', () => {
      expect(rollOutcome({ kind: 'roll', max: 6 }, fakeRandomInt(1))).toEqual({
        kind: 'roll',
        max: 6,
        value: 1,
      })
      expect(rollOutcome({ kind: 'roll', max: 6 }, fakeRandomInt(6))).toEqual({
        kind: 'roll',
        max: 6,
        value: 6,
      })
    })

    test('rolls the largest allowed range without overflowing it', () => {
      const randomInt = fakeRandomInt(ROLL_MAX_MAX)

      expect(rollOutcome({ kind: 'roll', max: ROLL_MAX_MAX }, randomInt)).toEqual({
        kind: 'roll',
        max: ROLL_MAX_MAX,
        value: ROLL_MAX_MAX,
      })
      expect(randomInt).toHaveBeenCalledWith(1, ROLL_MAX_MAX + 1)
    })
  })

  describe('flip', () => {
    test('maps the low draw to heads', () => {
      const randomInt = fakeRandomInt(0)

      expect(rollOutcome({ kind: 'flip' }, randomInt)).toEqual({ kind: 'flip', result: 'heads' })
      expect(randomInt).toHaveBeenCalledWith(0, 2)
    })

    test('maps the high draw to tails', () => {
      expect(rollOutcome({ kind: 'flip' }, fakeRandomInt(1))).toEqual({
        kind: 'flip',
        result: 'tails',
      })
    })
  })

  describe('eightBall', () => {
    test('answers with the indexed answer', () => {
      const randomInt = fakeRandomInt(3)

      expect(rollOutcome({ kind: 'eightBall', question: 'will it work?' }, randomInt)).toEqual({
        kind: 'eightBall',
        answer: EIGHT_BALL_ANSWERS[3],
      })
      expect(randomInt).toHaveBeenCalledWith(0, EIGHT_BALL_ANSWERS.length)
    })

    test('can reach the last answer', () => {
      expect(
        rollOutcome(
          { kind: 'eightBall', question: 'q' },
          fakeRandomInt(EIGHT_BALL_ANSWERS.length - 1),
        ),
      ).toEqual({
        kind: 'eightBall',
        answer: EIGHT_BALL_ANSWERS[EIGHT_BALL_ANSWERS.length - 1],
      })
    })

    test('leaves the question out of the outcome, since the message carries it', () => {
      expect(
        rollOutcome({ kind: 'eightBall', question: 'will it work?' }, fakeRandomInt(0)),
      ).not.toHaveProperty('question')
    })
  })

  describe('quote', () => {
    test('picks one of the named unit lines, leaving the unit alone', () => {
      const randomInt = fakeRandomInt(2)

      expect(rollOutcome({ kind: 'quote', unit: 'marine' }, randomInt)).toEqual({
        kind: 'quote',
        unit: 'marine',
        line: UNIT_QUOTES.marine[2],
      })
      expect(randomInt).toHaveBeenCalledWith(0, UNIT_QUOTES.marine.length)
      expect(randomInt).toHaveBeenCalledTimes(1)
    })

    test('picks the unit too when the request names none', () => {
      const randomInt = fakeRandomInt(1)
      const unit = QUOTE_UNITS[1]

      expect(rollOutcome({ kind: 'quote' }, randomInt)).toEqual({
        kind: 'quote',
        unit,
        line: UNIT_QUOTES[unit][1],
      })
      expect(randomInt).toHaveBeenCalledWith(0, QUOTE_UNITS.length)
      expect(randomInt).toHaveBeenCalledWith(0, UNIT_QUOTES[unit].length)
    })

    test('can reach the last unit and its last line', () => {
      const unit = QUOTE_UNITS[QUOTE_UNITS.length - 1]
      const lines = UNIT_QUOTES[unit]

      expect(
        rollOutcome(
          { kind: 'quote' },
          vi.fn((_min: number, max: number) => max - 1),
        ),
      ).toEqual({
        kind: 'quote',
        unit,
        line: lines[lines.length - 1],
      })
    })
  })

  test('stays inside the requested range with the real generator', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 200; i++) {
      const outcome = rollOutcome({ kind: 'roll', max: 3 })
      if (outcome.kind !== 'roll') {
        throw new Error(`rolled a ${outcome.kind} for a roll request`)
      }

      expect(outcome.max).toBe(3)
      expect(outcome.value).toBeGreaterThanOrEqual(1)
      expect(outcome.value).toBeLessThanOrEqual(3)
      seen.add(outcome.value)
    }

    // Every value in so short a range is overwhelmingly likely to come up over this many draws, so
    // a generator stuck on one of them (or unable to reach an end of the range) shows up here.
    expect(Array.from(seen).sort()).toEqual([1, 2, 3])
  })
})
