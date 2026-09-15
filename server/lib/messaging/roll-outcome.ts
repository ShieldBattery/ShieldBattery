import { randomInt as cryptoRandomInt } from 'node:crypto'
import { assertUnreachable } from '../../../common/assert-unreachable'
import {
  EIGHT_BALL_ANSWERS,
  ROLL_DEFAULT_MAX,
  RolledOutcome,
  RolledOutcomeRequest,
} from '../../../common/rolled-outcomes'

/**
 * Settles what a client asked for: a roll, a coin flip, or an 8-ball answer.
 *
 * These outcomes are what people settle things between themselves with (who picks the map, who
 * takes which spawn), so the pick has to be uniform over the whole range and unguessable from the
 * ones before it. `crypto.randomInt` is both: it draws from the platform's cryptographic generator
 * and discards the draws that would skew the range. Folding a `Math.random` value into a range
 * instead favors some values over others, and leaks enough generator state to predict what comes
 * next.
 *
 * `randomInt` returns an integer in `[min, max)` -- upper bound exclusive, as `crypto.randomInt`
 * has it. Tests pass their own to settle an outcome deterministically.
 */
export function rollOutcome(
  request: RolledOutcomeRequest,
  randomInt: (min: number, max: number) => number = cryptoRandomInt,
): RolledOutcome {
  switch (request.kind) {
    case 'roll': {
      const max = request.max ?? ROLL_DEFAULT_MAX
      return { kind: 'roll', max, value: randomInt(1, max + 1) }
    }
    case 'flip':
      return { kind: 'flip', result: randomInt(0, 2) === 0 ? 'heads' : 'tails' }
    case 'eightBall':
      return {
        kind: 'eightBall',
        answer: EIGHT_BALL_ANSWERS[randomInt(0, EIGHT_BALL_ANSWERS.length)],
      }
    default:
      return assertUnreachable(request)
  }
}
