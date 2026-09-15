import Joi from 'joi'
import {
  ROLL_MAX_MAX,
  ROLL_MIN_MAX,
  RolledOutcome,
  RolledOutcomeRequest,
} from '../../../common/rolled-outcomes'
import { QUOTE_UNITS, QuoteUnit } from '../../../common/unit-quotes'

/**
 * Every key an outcome request can carry, as one flat shape. A request is a union narrowed by its
 * `kind`, but a Joi key map has to name each key any of the kinds might bring.
 */
interface RolledOutcomeRequestFields {
  kind: RolledOutcome['kind']
  max?: number
  question?: string
  unit?: QuoteUnit
}

/**
 * The keys of an outcome request's body, so a surface that carries something of its own alongside
 * them (a lobby request's client id) can spread them into its own body schema.
 *
 * `max`, `question` and `unit` each belong to exactly one kind and are refused on the others, so a
 * question can't ride along on a roll and be stored as the message's text without the 8-ball having
 * been asked anything.
 */
export const ROLLED_OUTCOME_REQUEST_KEYS: Joi.SchemaMap<RolledOutcomeRequestFields> = {
  kind: Joi.string().valid('roll', 'flip', 'eightBall', 'quote').required(),
  max: Joi.number().integer().min(ROLL_MIN_MAX).max(ROLL_MAX_MAX).when('kind', {
    is: 'roll',
    otherwise: Joi.forbidden(),
  }),
  question: Joi.string().min(1).when('kind', {
    is: 'eightBall',
    then: Joi.required(),
    otherwise: Joi.forbidden(),
  }),
  unit: Joi.string()
    .valid(...QUOTE_UNITS)
    .when('kind', {
      is: 'quote',
      otherwise: Joi.forbidden(),
    }),
}

/** The body of an outcome request on a surface that needs nothing else with it. */
export const rolledOutcomeRequestBody = Joi.object<
  RolledOutcomeRequest,
  false,
  RolledOutcomeRequestFields
>(ROLLED_OUTCOME_REQUEST_KEYS)
