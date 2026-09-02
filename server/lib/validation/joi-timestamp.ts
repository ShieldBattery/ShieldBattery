import Joi from 'joi'

/**
 * The largest instant a JS `Date` can represent, in epoch milliseconds. `new Date(value)` past this
 * is an Invalid Date, which serializes toward Postgres as `NaN` and is rejected there as a
 * malformed timestamp, so any epoch-millisecond value that will become a `Date` has to be bounded
 * by it.
 */
export const MAX_DATE_MILLIS = 8640000000000000

/**
 * A timestamp in epoch milliseconds, bounded above by what a JS `Date` can represent. Callers add
 * their own lower bound and any sentinel values they accept.
 */
export const joiTimestampMillis = () => Joi.number().max(MAX_DATE_MILLIS)
