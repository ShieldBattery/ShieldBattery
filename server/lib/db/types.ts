import { IsOptional } from 'prop-types'
import { Simplify, SnakeCase } from 'type-fest'

/**
 * Utility type to map TS types to one that works with Postgres, by changing any `camelCase` keys to
 * `snake_case`.
 */
export type Dbify<InputType> = Simplify<{
  [K in keyof InputType as SnakeCase<K>]: IsOptional<InputType[K]> extends true
    ? InputType[K] | null
    : InputType[K]
}>
