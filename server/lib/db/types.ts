import { SnakeCase } from 'type-fest'

/**
 * Utility type to map TS types to one that works with Postgres, by changing any `camelCase` keys to
 * `snake_case`.
 */
export type Dbify<InputType> = {
  [K in keyof InputType as SnakeCase<K>]: InputType[K]
}
