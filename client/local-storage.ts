import logger from './logging/logger'

/**
 * A manager for a JSON value stored in local storage. Provides easy methods to set and retrieve
 * the value (if any), doing the necessary parsing/encoding.
 */
export class JsonLocalStorageValue<T> {
  constructor(readonly name: string) {}

  /**
   * Retrieves the current `localStorage` value (parsed as JSON).
   * @returns the parsed value, or `undefined` if it isn't set or fails to parse.
   */
  getValue(): T | undefined {
    const valueJson = localStorage.getItem(this.name)
    if (valueJson === null) {
      return undefined
    }

    try {
      return JSON.parse(valueJson)
    } catch (err) {
      logger.error(`error parsing value for ${this.name}: ${(err as any).stack ?? err}`)
      return undefined
    }
  }

  /**
   * Sets the current `localStorage` value, encoding it as JSON.
   */
  setValue(value: T): void {
    localStorage.setItem(this.name, JSON.stringify(value))
  }

  /**
   * Clears (unsets) the current `localStorage` value.
   */
  clear(): void {
    localStorage.removeItem(this.name)
  }
}
