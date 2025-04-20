// Utility functions for use on Maps

/**
 * Appends `item` to an array at `key` in `map`, creating the array entry if it does not exist.
 */
export function appendToMultimap<K, T>(map: Map<K, T[]>, key: K, item: T) {
  const value = map.get(key)

  if (value !== undefined) {
    value.push(item)
  } else {
    map.set(key, [item])
  }
}

/**
 * Prepends `item` to an array at `key` in `map`, creating the array entry if it does not exist.
 */
export function prependToMultimap<K, T>(map: Map<K, T[]>, key: K, item: T) {
  const value = map.get(key)

  if (value !== undefined) {
    value.unshift(item)
  } else {
    map.set(key, [item])
  }
}

/**
 * Merges two multimaps into a new one. A new map will be returned, leaving the original maps
 * unmodified. Arrays within the map values will be copied.
 */
export function mergeMultimaps<K, T>(
  mapA: ReadonlyMap<K, ReadonlyArray<T>>,
  mapB: ReadonlyMap<K, ReadonlyArray<T>>,
): Map<K, T[]> {
  const result = cloneMultimap(mapA)
  for (const [key, value] of mapB) {
    const existing = result.get(key)
    if (existing) {
      result.set(key, existing.concat(value))
    } else {
      result.set(key, value.slice(0))
    }
  }

  return result
}

/**
 * Returns a new map with the same keys and values as the original, but with the value arrays
 * copied. Value references within the arrays will not be copied.
 */
export function cloneMultimap<K, T>(map: ReadonlyMap<K, ReadonlyArray<T>>): Map<K, T[]> {
  return new Map(Array.from(map, ([key, value]) => [key, value.slice(0)]))
}
