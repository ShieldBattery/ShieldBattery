// Utility functions for dealing with random numbers, picking random entries, etc.

/** Returns a random integer in the range `[min, max)` */
export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min)) + min
}

/** Returns a random item from the list of items. */
export function randomItem<T>(items: ReadonlyArray<T>): T {
  if (!items.length) {
    throw new Error('Cannot pick a random item from an empty list')
  } else if (items.length === 1) {
    return items[0]
  } else {
    return items[randomInt(0, items.length)]
  }
}

/**
 * Returns multiple random items from the list (guaranteeing no duplicates). Note that this
 * will create a copy of the array internally.
 */
export function multipleRandomItems<T>(amount: number, items: ReadonlyArray<T>): T[] {
  if (amount > items.length) {
    throw new Error(`Cannot select ${amount} items from a list of size ${items.length}`)
  }
  if (amount === 1) {
    return [randomItem(items)]
  }

  const workingItems = items.slice()

  const result: T[] = []
  // Select random items from the list, moving items from the end of the list to the chosen
  // location, and decreasing the range of possible selections. This allows us to effectively
  // shorten the list without actually changing its length or doing very much work
  for (let i = 0; i < amount; i++) {
    const index = randomInt(0, workingItems.length - i)
    result.push(workingItems[index])

    const toSwap = workingItems.length - 1 - i
    workingItems[index] = workingItems[toSwap]
  }

  return result
}

/**
 * Keeps selecting random items from the list (guaranteeing no duplicates) until `shouldContinueFn`
 * returns `false` or all items have been selected. Note that this will create a copy of the array
 * internally.
 *
 * @returns the list of selected items
 */
export function multipleRandomItemsUntil<T>(
  items: ReadonlyArray<T>,
  shouldContinueFn: (curItems: ReadonlyArray<T>) => boolean,
): T[] {
  const workingItems = items.slice()

  const result: T[] = []
  // Select random items from the list, moving items from the end of the list to the chosen
  // location, and decreasing the range of possible selections. This allows us to effectively
  // shorten the list without actually changing its length or doing very much work
  for (let i = 0; i < items.length && shouldContinueFn(result); i++) {
    const index = randomInt(0, workingItems.length - i)
    result.push(workingItems[index])

    const toSwap = workingItems.length - 1 - i
    workingItems[index] = workingItems[toSwap]
  }

  return result
}
