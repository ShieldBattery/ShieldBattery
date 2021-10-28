/**
 * Extends a `RegExpMatchArray` type (which is used by `String.match()` and `String.matchAll()`)
 * with a generic argument that is used to type the groups more strongly.
 */
export interface TypedGroupRegExpMatchArray<T extends string> extends RegExpMatchArray {
  groups: Record<T, string>
}
