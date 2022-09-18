/** A utility class for easily setting and retrieving a value from Reflect metadata. */
// Lint disabled because that's what the API expects :(
// eslint-disable-next-line @typescript-eslint/ban-types
export class MetadataValue<V, Target extends Object = any> {
  constructor(readonly key: symbol) {}

  /** Sets the metadata value for `target`. This will overwrite any value there previously. */
  set(target: Target, value: V | undefined): void {
    Reflect.defineMetadata(this.key, value, target)
  }

  /** Returns the metdata value currently set on the target, or undefined if not set. */
  get(target: Target): V | undefined {
    return Reflect.getOwnMetadata(this.key, target)
  }
}

/** A utility class for easily setting and retrieving a list of values from Reflect metadata. */
// Lint disabled because that's what the API expects :(
// eslint-disable-next-line @typescript-eslint/ban-types
export class MetadataListValue<V, Target extends Object = any> {
  constructor(readonly key: symbol) {}

  /**
   * Adds a value to the end of the list of values in metadata. A new list will be created if
   * necessary.
   */
  push(target: Target, value: V): void {
    const list: V[] = this.get(target)
    list.push(value)
    Reflect.defineMetadata(this.key, list, target)
  }

  /**
   * Adds a value to the beginning of the list of values in metadata. A new list will be created if
   * necessary.
   */
  unshift(target: Target, value: V): void {
    const list: V[] = this.get(target)
    list.unshift(value)
    Reflect.defineMetadata(this.key, list, target)
  }

  /** Clears the current list of values on `target`. */
  clear(target: Target): void {
    Reflect.defineMetadata(this.key, undefined, target)
  }

  /** Returns the metdata value currently set on the target. Returns an empty list if not set. */
  get(target: Target): V[] {
    return Reflect.getOwnMetadata(this.key, target) ?? []
  }
}

/** A utility class for easily setting and retrieving a Map of entries from Reflect metadata. */
// Lint disabled because that's what the API expects :(
// eslint-disable-next-line @typescript-eslint/ban-types
export class MetadataMapValue<K, V, Target extends Object = any> {
  constructor(readonly metadataKey: symbol) {}

  /**
   * Sets a value for the specified key in the Map stored in metadata. A new Map will be created if
   * necessary.
   */
  setEntry(target: Target, key: K, value: V): void {
    const stored: Map<K, V> = this.get(target)
    stored.set(key, value)
    Reflect.defineMetadata(this.metadataKey, stored, target)
  }

  /**
   * Retrieves the current value for the specified key in the Map stored in metadata, or undefined
   * if the key is not set.
   */
  getEntryValue(target: Target, key: K): V | undefined {
    const stored: Map<K, V> | undefined = Reflect.getOwnMetadata(this.metadataKey, target)
    return stored?.get(key)
  }

  /** Clears the current Map `target`. */
  clear(target: Target): void {
    Reflect.defineMetadata(this.metadataKey, undefined, target)
  }

  /** Returns the metdata value currently set on the target. Returns an empty Map if not set. */
  get(target: Target): Map<K, V> {
    return Reflect.getOwnMetadata(this.metadataKey, target) ?? new Map()
  }
}
