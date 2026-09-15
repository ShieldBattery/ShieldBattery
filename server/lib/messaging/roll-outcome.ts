import { assertUnreachable } from '../../../common/assert-unreachable'
import { randomInt as defaultRandomInt } from '../../../common/random'
import {
  EIGHT_BALL_ANSWERS,
  ROLL_DEFAULT_MAX,
  RolledOutcome,
  RolledOutcomeRequest,
} from '../../../common/rolled-outcomes'

/**
 * Settles what a client asked for: a roll, a coin flip, or an 8-ball answer.
 *
 * The server rolls these rather than the client so the outcome a message carries is one the
 * sender couldn't have picked. Plain `Math.random` is enough for that: nothing here guards
 * anything of value, it just has to be a roll the sender didn't choose.
 *
 * `randomInt` returns an integer in `[min, max)` -- upper bound exclusive. Tests pass their own to
 * settle an outcome deterministically.
 */
export function rollOutcome(
  request: RolledOutcomeRequest,
  randomInt: (min: number, max: number) => number = defaultRandomInt,
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
