import { List } from 'immutable'

export type Comparator<T> = (valueA: T, valueB: T) => number

/** Creates a new list with the specified data, sorted by `sortFn`. */
export function create<T>(sortFn: Comparator<T>, data?: Iterable<T>): List<T> {
  return data ? List(data).sort(sortFn) : List()
}

/** Finds an item's index in a sorted list using a binary search. Returns -1 if not found. */
export function findIndex<T>(sortFn: Comparator<T>, list: List<T>, entry: T): number {
  let first = 0
  let last = list.size - 1
  while (first <= last) {
    const midpoint = ((first + last) / 2) >>> 0
    const sortResult = sortFn(entry, list.get(midpoint)!)
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

/** Inserts an item in a previously sorted list, doing a binary search to find the proper index. */
export function insert<T>(sortFn: Comparator<T>, list: List<T>, entry: T): List<T> {
  let first = 0
  let last = list.size - 1
  while (first <= last) {
    const midpoint = ((first + last) / 2) >>> 0
    const sortResult = sortFn(entry, list.get(midpoint)!)
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

export interface SortedListOperations<T> {
  /** Creates a new List. If data is provided, it will be run through the sort function. */
  create(data?: Iterable<T>): List<T>
  /** Finds an item's index in a sorted list using a binary search. Returns -1 if not found. */
  findIndex(list: List<T>, entry: T): number
  /**
   * Inserts an item in a previously sorted list, doing a binary search to find the proper index.
   *
   * @returns the new List after mutation
   */
  insert(list: List<T>, entry: T): List<T>
}

export function createSortedOps<T>(sortFn: Comparator<T>): SortedListOperations<T> {
  return {
    create(data) {
      return create(sortFn, data)
    },

    findIndex(list, entry) {
      return findIndex(sortFn, list, entry)
    },

    insert(list, entry) {
      return insert(sortFn, list, entry)
    },
  }
}
