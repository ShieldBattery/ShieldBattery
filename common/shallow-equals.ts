/**
 * Returns whether two objects are equal at the first level of keys (that is, all of their
 * top-level keys have referentially-equal (`===`) values).
 *
 * @example
 * const value = { hello: 'world' }
 * shallowEquals({ value, other: 5 }, { value, other: 5 }) // returns true
 * shallowEquals({ hello: 'world', complex: { thing: 5 } },
 *   { hello: 'world', complex: { thing: 5 } }) // returns false, `complex` not ===
 */
export default function shallowEquals<T extends Record<string, any>>(objA: T, objB: T): boolean {
  if (objA === objB) {
    return true
  }

  const keysA = Object.keys(objA)
  const keysB = Object.keys(objB)

  if (keysA.length !== keysB.length) {
    return false
  }

  const hasOwn = Object.prototype.hasOwnProperty
  for (let i = 0; i < keysA.length; i++) {
    if (!hasOwn.call(objB, keysA[i]) || objA[keysA[i]] !== objB[keysA[i]]) {
      return false
    }
  }

  return true
}
