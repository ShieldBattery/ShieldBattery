import { Merge, OptionalKeysOf, RequiredKeysOf } from 'type-fest'

/**
 * An object that specifies desired changes to another existing object. All keys become optional,
 * and any fields that were originally optional become nullable. `undefined` implies that no changes
 * will be made to the field, `null` implies that the field should be deleted.
 */
export type Patch<T extends object> = Merge<
  { [K in RequiredKeysOf<T>]?: T[K] },
  { [K in OptionalKeysOf<T> & keyof T]?: T[K] | null }
>
