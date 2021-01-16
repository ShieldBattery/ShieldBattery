type CamelToSnakeCase<S> = S extends string
  ? S extends `${infer T}${infer U}`
    ? `${T extends Capitalize<T> ? '_' : ''}${Lowercase<T>}${CamelToSnakeCase<U>}`
    : S
  : S

/**
 * Utility type to map TS types to one that works with Postgres, by changing any `camelCase` keys to
 * `snake_case`.
 */
export type Dbify<InputType> = {
  [K in keyof InputType as CamelToSnakeCase<K>]: InputType[K]
}
