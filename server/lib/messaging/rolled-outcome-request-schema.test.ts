import { describe, expect, test } from 'vitest'
import { ROLL_MAX_MAX, ROLL_MIN_MAX } from '../../../common/rolled-outcomes'
import { rolledOutcomeRequestBody } from './rolled-outcome-request-schema'

describe('messaging/rolled-outcome-request-schema', () => {
  describe('roll', () => {
    test('accepts a request with no upper bound, leaving the default to the server', () => {
      const { error, value } = rolledOutcomeRequestBody.validate({ kind: 'roll' })

      expect(error).toBeUndefined()
      expect(value).toEqual({ kind: 'roll' })
    })

    test('converts the upper bound clients send form-encoded', () => {
      // Clients post these bodies as form params, so every number arrives as a string.
      const { error, value } = rolledOutcomeRequestBody.validate({ kind: 'roll', max: '6' })

      expect(error).toBeUndefined()
      expect(value).toEqual({ kind: 'roll', max: 6 })
    })

    test('refuses an upper bound outside the allowed range', () => {
      expect(
        rolledOutcomeRequestBody.validate({ kind: 'roll', max: String(ROLL_MIN_MAX - 1) }).error,
      ).toBeDefined()
      expect(
        rolledOutcomeRequestBody.validate({ kind: 'roll', max: String(ROLL_MAX_MAX + 1) }).error,
      ).toBeDefined()
    })

    test('refuses a fractional upper bound', () => {
      expect(rolledOutcomeRequestBody.validate({ kind: 'roll', max: '6.5' }).error).toBeDefined()
    })

    test('refuses a question, which only the 8-ball is asked', () => {
      expect(
        rolledOutcomeRequestBody.validate({ kind: 'roll', question: 'sneaky' }).error,
      ).toBeDefined()
    })

    test('refuses a unit, which only a quote names', () => {
      expect(
        rolledOutcomeRequestBody.validate({ kind: 'roll', unit: 'marine' }).error,
      ).toBeDefined()
    })
  })

  describe('flip', () => {
    test('accepts a request carrying nothing else', () => {
      const { error, value } = rolledOutcomeRequestBody.validate({ kind: 'flip' })

      expect(error).toBeUndefined()
      expect(value).toEqual({ kind: 'flip' })
    })

    test('refuses an upper bound, which only a roll has', () => {
      expect(rolledOutcomeRequestBody.validate({ kind: 'flip', max: '6' }).error).toBeDefined()
    })

    test('refuses a unit, which only a quote names', () => {
      expect(
        rolledOutcomeRequestBody.validate({ kind: 'flip', unit: 'marine' }).error,
      ).toBeDefined()
    })
  })

  describe('eightBall', () => {
    test('accepts a request with a question', () => {
      const { error, value } = rolledOutcomeRequestBody.validate({
        kind: 'eightBall',
        question: 'will it work?',
      })

      expect(error).toBeUndefined()
      expect(value).toEqual({ kind: 'eightBall', question: 'will it work?' })
    })

    test('requires a question', () => {
      expect(rolledOutcomeRequestBody.validate({ kind: 'eightBall' }).error).toBeDefined()
    })

    test('refuses an empty question', () => {
      expect(
        rolledOutcomeRequestBody.validate({ kind: 'eightBall', question: '' }).error,
      ).toBeDefined()
    })

    test('refuses a unit, which only a quote names', () => {
      expect(
        rolledOutcomeRequestBody.validate({ kind: 'eightBall', question: 'q', unit: 'marine' })
          .error,
      ).toBeDefined()
    })
  })

  describe('quote', () => {
    test('accepts a request naming no unit, leaving the pick to the server', () => {
      const { error, value } = rolledOutcomeRequestBody.validate({ kind: 'quote' })

      expect(error).toBeUndefined()
      expect(value).toEqual({ kind: 'quote' })
    })

    test('accepts a unit the catalogue knows', () => {
      const { error, value } = rolledOutcomeRequestBody.validate({ kind: 'quote', unit: 'marine' })

      expect(error).toBeUndefined()
      expect(value).toEqual({ kind: 'quote', unit: 'marine' })
    })

    test('refuses a unit the catalogue does not know', () => {
      expect(
        rolledOutcomeRequestBody.validate({ kind: 'quote', unit: 'zergling' }).error,
      ).toBeDefined()
    })

    test('refuses a question, which only the 8-ball is asked', () => {
      expect(
        rolledOutcomeRequestBody.validate({ kind: 'quote', question: 'sneaky' }).error,
      ).toBeDefined()
    })
  })

  test('requires a kind it knows', () => {
    expect(rolledOutcomeRequestBody.validate({}).error).toBeDefined()
    expect(rolledOutcomeRequestBody.validate({ kind: 'dice' }).error).toBeDefined()
  })
})
