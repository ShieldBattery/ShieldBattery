/**
 * Outcomes that chat commands ask the server to settle (`/roll`, `/flip`, `/8ball`). The server
 * picks the result and announces it as an action line carrying a `RolledOutcome`, so the result
 * can't be typed by hand: an ordinary message (including one sent with `/me`) never carries one.
 */

/** The upper bound `/roll` uses when none is given: the roll is 1 to this, inclusive. */
export const ROLL_DEFAULT_MAX = 100
/** The smallest upper bound `/roll` accepts. A roll of 1 to 1 settles nothing. */
export const ROLL_MIN_MAX = 2
/** The largest upper bound `/roll` accepts. */
export const ROLL_MAX_MAX = 1_000_000

/**
 * The answers a magic 8-ball gives, as the keys the client localizes them by. The order is the
 * classic toy's: ten affirmative, five non-committal, five negative.
 */
export const EIGHT_BALL_ANSWERS = [
  'itIsCertain',
  'itIsDecidedlySo',
  'withoutADoubt',
  'yesDefinitely',
  'youMayRelyOnIt',
  'asISeeItYes',
  'mostLikely',
  'outlookGood',
  'yes',
  'signsPointToYes',
  'replyHazyTryAgain',
  'askAgainLater',
  'betterNotTellYouNow',
  'cannotPredictNow',
  'concentrateAndAskAgain',
  'dontCountOnIt',
  'myReplyIsNo',
  'mySourcesSayNo',
  'outlookNotSoGood',
  'veryDoubtful',
] as const

export type EightBallAnswer = (typeof EIGHT_BALL_ANSWERS)[number]

export type CoinSide = 'heads' | 'tails'

/**
 * What the server settled, as the action line announcing it carries it. The line's wording is
 * composed by the client from this, in the viewer's own language; the message's `text` holds only
 * the words the user themselves typed (the question put to the 8-ball), and is empty otherwise.
 */
export type RolledOutcome =
  | {
      kind: 'roll'
      /** The roll was 1 to this, inclusive. */
      max: number
      value: number
    }
  | { kind: 'flip'; result: CoinSide }
  | { kind: 'eightBall'; answer: EightBallAnswer }

/** What a client asks the server to settle. The body of every `outcomes` endpoint. */
export type RolledOutcomeRequest =
  | {
      kind: 'roll'
      /** `ROLL_MIN_MAX` to `ROLL_MAX_MAX`; `ROLL_DEFAULT_MAX` when left out. */
      max?: number
    }
  | { kind: 'flip' }
  | {
      kind: 'eightBall'
      /** The question put to the 8-ball, which the announcing line repeats. */
      question: string
    }
