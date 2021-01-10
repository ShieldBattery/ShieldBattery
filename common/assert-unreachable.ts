/**
 * Assert (through the type system) that a particular code path should be unreachable. This can be
 * used for things like making sure switch cases are exhaustive for a particular type. Note that
 * this is *NOT* a substitute for run-time checks. If the data entering the function is dynamic and
 * comes from outside the codebase, validity must be ensured before using things like this.
 *
 * Example:
 * ```
 * switch (foo) {
 *  case Foo.One: return 1;
 *  case Foo.Two: return 2;
 * }
 *
 * return assertUnreachable(foo);
 * ```
 */
export function assertUnreachable(x: never): never {
  throw new Error('Should have been unreachable for: ' + x)
}
