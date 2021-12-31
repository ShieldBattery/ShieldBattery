import Joi from 'joi'
import isDev from '../env/is-dev'

export function joiClientIdentifiers() {
  return Joi.array()
    .items(
      Joi.array().ordered(
        Joi.number().min(0).max(7).required(),
        Joi.string().min(0).max(64).required(),
      ),
    )
    .min(1)
}

/**
 * How many identifiers have to match for a user to be considered as being on the same machine.
 */
export const MIN_BANNED_IDENTIFIER_MATCHES = isDev ? 1 : 4
