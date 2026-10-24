import Joi from 'joi'
import { Context } from 'koa'
import isDev from '../env/is-dev'
import { isElectronClient } from '../network/electron-clients'

export function joiClientIdentifiers(ctx: Context) {
  return Joi.array()
    .items(
      Joi.array()
        .length(2)
        .ordered(
          Joi.number().integer().min(0).max(9).required(),
          Joi.alternatives().conditional(Joi.ref('0'), {
            is: 0,
            then: Joi.string().min(1).max(64).required(),
            otherwise: Joi.string()
              .pattern(/^[0-9a-f]{64}$/i)
              .required(),
          }),
        ),
    )
    .unique((left: [number, string], right: [number, string]) => left[0] === right[0])
    .max(10)
    .min(isElectronClient(ctx) ? 1 : 0)
}

export type ClientIdentifierString = [type: number, hashStr: string]
export type ClientIdentifierBuffer = [type: number, hash: Buffer]

/**
 * How many identifiers have to match for a user to be considered as being on the same machine.
 */
export const MIN_IDENTIFIER_MATCHES = isDev ? 1 : 4
