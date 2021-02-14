import { EventEmitter } from 'events'
import TypedEmitter from 'typed-emitter'

/**
 * A typed version of the normal node EventEmitter class, such that emitted/handled events and
 * their associated parameters can be type-checked properly.
 *
 * This uses typed-emitter under the hood, it just makes it easier to extend.
 *
 * Example:
 * ```
 * interface FooEvents {
 *   bar: (message: string) => void
 *   baz: (count: number, ...extras: any[]) => void
 * }
 *
 * class Foo extends TypedEventEmitter<FooEvents> {
 *   constructor() {
 *     super()
 *   }
 *
 *   test() {
 *     this.emit('bar', 'hello world')
 *     this.emit('baz', 5, 'extra', 'stuff', 'to', 'pass', 27)
 *   }
 * }
 * ```
 */
export abstract class TypedEventEmitter<T> extends (EventEmitter as {
  new <T>(): TypedEmitter<T>
})<T> {
  constructor() {
    // NOTE(tec27): No idea why eslint thinks super isn't a constructor here, I assume it's failing
    // to parse things properly in some way
    // eslint-disable-next-line constructor-super
    super()
  }
}
