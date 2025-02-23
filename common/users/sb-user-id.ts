import { Tagged } from 'type-fest'

export type SbUserId = Tagged<number, 'SbUser'>

/**
 * Converts a user ID number into a properly typed version. Alternative methods of retrieving an
 * SbUserId should be preferred, such as using a value retrieved from the database, or getting one
 * via the common Joi validator.
 */
export function makeSbUserId(id: number): SbUserId {
  return id as SbUserId
}
