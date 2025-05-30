// Utility functions for use on Arrays

/**
 * Returns the index of the last element in the array where `callbackFn` returns `true`, and -1
 * otherwise.
 */
export function findLastIndex<T>(
  array: ReadonlyArray<T>,
  callbackFn: (element: T, index: number, arr: ReadonlyArray<T>) => boolean,
): number {
  for (let i = array.length - 1; i >= 0; i--) {
    if (callbackFn(array[i], i, array)) {
      return i
    }
  }

  return -1
}

/**
 * Performs a binary search for `value` in `array`, returning the index of the element that matches.
 * If no element matches, returns `-1`.
 *
 * @param array The data to search within
 * @param value The value to search for
 * @param compareFn A function that compares an element to the value being searched for, returning
 *   a negative number if `entry` is less than `value`, 0 if equal, or a positive number if `entry`
 *   is greater than `value`.
 */
export function binarySearch<T, V>(
  array: ReadonlyArray<T>,
  value: V,
  compareFn: (entry: T, value: V) => number,
): number {
  let low = 0
  let high = array.length - 1

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const result = compareFn(array[mid], value)

    if (result < 0) {
      low = mid + 1
    } else if (result > 0) {
      high = mid - 1
    } else {
      return mid
    }
  }

  return -1
}

/**
 * Concatenates two arrays and removes duplicates. If the arrays contain objects, a function can be
 * provided as the third argument which should return the value based on which the uniqueness will
 * be checked.
 *
 * @param array1 The first array to use for concatenation.
 * @param array2 The second array that will be appended to the first one.
 * @param keyFn A function that returns the value based on which the uniqueness will be checked.
 *   Defaults to the identity function (to support arrays of non-objects).
 */
export function concatWithoutDuplicates<T, U>(
  array1: ReadonlyArray<T>,
  array2: ReadonlyArray<T>,
  keyFn?: (value: T) => U,
): Array<T> {
  const getKey = keyFn ?? ((value: T) => value)
  const seen = new Set()
  return array1.concat(array2).filter(t => {
    const key = getKey(t)
    const result = !seen.has(key)
    seen.add(key)
    return result
  })
}
