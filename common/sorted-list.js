import { List } from 'immutable'

// Creates a new list with the specified data, sorted by `sortFn`
export function create(sortFn, data) {
  return new List(data).sort(sortFn)
}

// Finds an item's index in a sorted list using a binary search. Returns -1 if not found
export function findIndex(sortFn, list, entry) {
  let first = 0
  let last = list.size - 1
  while (first <= last) {
    const midpoint = ((first + last) / 2) >>> 0
    const sortResult = sortFn(entry, list.get(midpoint))
    if (sortResult < 0) {
      last = midpoint - 1
    } else if (sortResult > 0) {
      first = midpoint + 1
    } else {
      return midpoint
    }
  }

  return -1
}

// Inserts an item in a previously sorted list, doing a binary search to find the proper index
export function insert(sortFn, list, entry) {
  let first = 0
  let last = list.size - 1
  while (first <= last) {
    const midpoint = ((first + last) / 2) >>> 0
    const sortResult = sortFn(entry, list.get(midpoint))
    if (sortResult < 0) {
      last = midpoint - 1
    } else if (sortResult > 0) {
      first = midpoint + 1
    } else {
      return list.insert(midpoint, entry)
    }
  }

  return list.insert(first, entry)
}
