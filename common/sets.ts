// Utility functions for use on Sets

/**
 * Returns a Set containing the combination of all the elements in two specified Sets.
 */
export function union<T>(first: ReadonlySet<T>, second: ReadonlySet<T>): Set<T> {
  const result = new Set(first)
  for (const elem of second) {
    result.add(elem)
  }

  return result
}

/**
 * Returns a Set containing only elements that are present in both specified Sets.
 */
export function intersection<T>(first: ReadonlySet<T>, second: ReadonlySet<T>): Set<T> {
  const result = new Set<T>()
  for (const elem of first) {
    if (second.has(elem)) {
      result.add(elem)
    }
  }

  return result
}

/**
 * Subtracts all of the elements in the second Set from the elements in the first, returning the
 * result in a new Set.
 */
export function subtract<T>(first: ReadonlySet<T>, second: ReadonlySet<T>): Set<T> {
  const result = new Set(first)
  for (const elem of second) {
    result.delete(elem)
  }

  return result
}
