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

/**
 * A decorator that can only be used on parameters of type `ParamType`.
 *
 * NOTE(tec27): This currently DOESN'T WORK, but should after this issue is fixed:
 * https://github.com/microsoft/TypeScript/issues/43132
 *
 * @example
 * function onlyStrings(): TypedParamDecorator<string> {
 *   return (target, propertyKey, parameterIndex) => {
 *     // do something with target[properyKey] here
 *   }
 * }
 */
export type TypedParamDecorator<ParamType> = <
  T extends Record<K, (...args: A) => unknown>,
  K extends string,
  I extends number,
  A extends any[] & { [P in I]: ParamType } & { length: any },
>(
  target: T,
  propertyKey: K,
  propertyIndex: I,
) => void
