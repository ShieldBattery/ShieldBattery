// Utility functions for use on Maps

/**
 * Appends `item` to an array at `key` on `map`, creating the array entry if it does not exist.
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
 * Prepends `item` to an array at `key`. creating the array entry if it does not exist.
 */
export function prependToMultimap<K, T>(map: Map<K, T[]>, key: K, item: T) {
  const value = map.get(key)

  if (value !== undefined) {
    value.unshift(item)
  } else {
    map.set(key, [item])
  }
}
