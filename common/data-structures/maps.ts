// Utility functions for use on Maps

/**
 * Takes a map and appends a new item to an array at a given key. If the key doesn't exist, a new
 * array with the item is created and inserted at the key.
 *
 * Mutates the input map instead of returning a new map.
 */
export function appendToMultimap<K, T>(map: Map<K, T[]>, key: K, item: T) {
  const value = map.get(key)

  if (value === undefined) {
    map.set(key, [item])
    return
  }

  value.push(item)
  map.set(key, value)
}

/**
 * Takes a map and prepends a new item to an array at a given key. If the key doesn't exist, a new
 * array with the item is created and inserted at the key.
 *
 * Mutates the input map instead of returning a new map.
 */
export function prependToMultimap<K, T>(map: Map<K, T[]>, key: K, item: T) {
  const value = map.get(key)

  if (value === undefined) {
    map.set(key, [item])
    return
  }

  value.unshift(item)
  map.set(key, value)
}
