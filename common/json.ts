import { Primitive } from 'type-fest'

/**
 * Converts a given type into a version that is passable as JSON, using our typical conventions.
 * Note that this won't totally ensure this conversion is possible (e.g. if you include a function
 * reference), but just does the typical type conversions.
 */
export type Jsonify<T> = T extends Primitive
  ? T
  : T extends Date
  ? number
  : T extends Map<infer Key, infer Value>
  ? [key: Key, value: Value][]
  : T extends Set<infer Value>
  ? Value[]
  : // eslint-disable-next-line @typescript-eslint/ban-types
  T extends object
  ? { [Key in keyof T]: Jsonify<T[Key]> }
  : T
