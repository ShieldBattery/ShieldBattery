// Helpful types/utilities for making decorators, this file should NOT be a dumping ground for
// random decorator classes

/** The types that can be used for declaring methods on an object/class. */
export type PropKey = string | symbol

/**
 * A decorator that can only be used on methods of type `MethodType`.
 *
 * @example
 * type StringifyFn = (value: number) => string
 *
 * function myCoolDecorator(): TypedMethodDecorator<StringifyFn> {
 *   return (target, propertyKey, desciptor) => {
 *     // do something with target[properyKey] here
 *   }
 * }
 */
export type TypedMethodDecorator<MethodType> = <K extends PropKey, T extends Record<K, MethodType>>(
  target: T,
  propertyKey: K,
  descriptor: PropertyDescriptor,
) => void
