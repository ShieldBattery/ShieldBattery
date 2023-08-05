import { Merge, OptionalKeysOf, RequiredKeysOf } from 'type-fest'

/**
 * Type which extends the type definition of optional keys to include `null` values. Mostly useful
 * in PATCH API requests.
 */
export type Patch<T extends object> = Merge<
  { [K in RequiredKeysOf<T>]?: T[K] },
  { [K in OptionalKeysOf<T>]?: T[K] | null }
>
