/**
 * Module-level storage for transient view state (scroll positions, message windows, drafts, …)
 * that should survive navigating away from a page and back within a session. It lives outside
 * React/Redux/Jotai on purpose: writing to it must never trigger a render, and it's only read and
 * written from effects, never during render — except a lazy `useState` initializer, which runs at
 * most once per mount and so never re-reads on a re-render (which keeps it safe under the React
 * Compiler).
 */

const MAX_ENTRIES = 50

interface StoredEntry {
  value: unknown
  savedAt: number
}

/**
 * A single shared map so total retained view state is bounded as a whole; insertion order doubles
 * as least-recently-used order because reads and writes re-insert.
 */
const entries = new Map<string, StoredEntry>()

export interface ViewStateStore<T> {
  get(key: string): T | undefined
  set(key: string, value: T): void
  /** Removes a stored entry, if one exists. */
  delete(key: string): void
}

/**
 * Creates a typed view onto the shared store. `namespace` isolates one feature's keys from
 * another's and must not contain ':'. Entries older than `maxAgeMs` are treated as absent. All
 * consumers share one LRU with capacity `MAX_ENTRIES`, bounding the total memory retained across
 * features (heavy use by one feature may evict another's oldest entries).
 */
export function createViewStateStore<T>(
  namespace: string,
  { maxAgeMs }: { maxAgeMs: number },
): ViewStateStore<T> {
  const fullKey = (key: string) => `${namespace}:${key}`

  return {
    get(key: string): T | undefined {
      const full = fullKey(key)
      const entry = entries.get(full)
      if (!entry) {
        return undefined
      }

      if (Date.now() - entry.savedAt > maxAgeMs) {
        entries.delete(full)
        return undefined
      }

      entries.delete(full)
      entries.set(full, entry)

      return entry.value as T
    },

    set(key: string, value: T): void {
      const full = fullKey(key)
      entries.delete(full)
      entries.set(full, { value, savedAt: Date.now() })

      if (entries.size > MAX_ENTRIES) {
        const oldestKey = entries.keys().next().value
        if (oldestKey !== undefined) {
          entries.delete(oldestKey)
        }
      }
    },

    delete(key: string): void {
      entries.delete(fullKey(key))
    },
  }
}

/**
 * Removes all stored entries across every namespace. Everything kept here belongs to whoever is
 * signed in — where they were reading, how far down a list they had scrolled — so it all stops
 * being meaningful at once when that changes. Also used to isolate tests from each other.
 */
export function clearViewState(): void {
  entries.clear()
}
