// Helpful types/utilities for making decorators, this file should NOT be a dumping ground for
// random decorator classes

/** The types that can be used for declaring methods on an object/class. */
export type PropKey = string | symbol

type MatchesMethodType<K extends PropKey, MethodType> = { [key in K]: MethodType }

/**
 * A decorator that can only be used on methods of type `MethodType`.
 *
 * @example
 * type StringifyFn = (value: number) => string
 *
 * function myCoolDecorator(): RestrictedMethodDecorator<StringifyFn> {
 *   return (target, propertyKey, desciptor) => {
 *     // do something with target[properyKey] here
 *   }
 * }
 */
export type RestrictedMethodDecorator<MethodType> = <
  K extends PropKey,
  T extends MatchesMethodType<K, MethodType>,
>(
  target: T,
  propertyKey: K,
  descriptor: PropertyDescriptor,
) => void
