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
