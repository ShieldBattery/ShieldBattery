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

export type ClientIdentifierString = [type: number, hashStr: string]
export type ClientIdentifierBuffer = [type: number, hash: Buffer]

/**
 * How many identifiers have to match for a user to be considered as being on the same machine.
 */
export const MIN_IDENTIFIER_MATCHES = isDev ? 1 : 4
