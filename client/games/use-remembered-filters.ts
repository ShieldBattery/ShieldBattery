import { useLayoutEffect, useState } from 'react'
import { replace } from '../navigation/routing'
import { useUserLocalStorageValue } from '../react/state-hooks'

/**
 * A filter surface that remembers its mode-like preferences (sort, duration bucket, and whichever
 * mode filters it shows) across visits. Each surface gets its own saved set, stored per user — so
 * match history's set belongs to the *viewing* user and is shared across every profile they look
 * at.
 *
 * Search-like filters (map/player name, format, matchup, date range) are deliberately never
 * remembered: silently re-applying a search on a later visit produces a mysteriously empty list.
 */
export type FilterMemorySurface = 'games' | 'matchHistory' | 'league' | 'replays'

/**
 * Raw URL-param values for a surface's remembered filters, keyed by param name. Values are exactly
 * what the URL carries, so an unset filter is `''` (or absent) and callers apply the same parse
 * functions they would apply to a raw param.
 */
export type FilterParamValues = Readonly<Record<string, string>>

const NO_VALUES: FilterParamValues = Object.freeze({})

/**
 * Whether the URL carries any of a surface's remembered params. The check is all-or-nothing across
 * the surface: a URL that pins even one of them is a deliberate destination (a shared link, or a
 * history entry being traversed back to) and describes the whole filter set on its own.
 */
export function urlHasRememberedFilters(urlValues: FilterParamValues): boolean {
  return Object.values(urlValues).some(value => !!value)
}

/** Reads the values of `keys` out of a search string, omitting the ones that are unset. */
export function readFilterParams(
  search: string,
  keys: ReadonlyArray<string>,
): Record<string, string> {
  const searchParams = new URLSearchParams(search)
  const result: Record<string, string> = {}
  for (const key of keys) {
    const value = searchParams.get(key)
    if (value) {
      result[key] = value
    }
  }
  return result
}

/**
 * Writes `values` into a search string and returns it in `?a=b` form (empty string when nothing is
 * left). Params not named in `values` are preserved as they were.
 */
export function withFilterParams(search: string, values: FilterParamValues): string {
  const searchParams = new URLSearchParams(search)
  for (const [key, value] of Object.entries(values)) {
    searchParams.set(key, value)
  }
  const searchString = searchParams.toString()
  return searchString ? `?${searchString}` : ''
}

/** Narrows `values` to `keys`, dropping unset entries and any key the surface doesn't use. */
function pickNonEmpty(values: FilterParamValues, keys: ReadonlyArray<string>): FilterParamValues {
  const result: Record<string, string> = {}
  for (const key of keys) {
    const value = values[key]
    if (value) {
      result[key] = value
    }
  }
  return result
}

/**
 * localStorage holds whatever an older version of the app wrote (or a user hand-edited), so
 * anything that isn't a plain object of non-empty strings is treated as unset. The strings
 * themselves aren't checked: they're the same raw values a URL can carry, and each surface's parse
 * functions already fall back to their defaults for garbage.
 */
function validateStoredValues(value: unknown): FilterParamValues | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined
  }

  const result: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' && entry) {
      result[key] = entry
    }
  }
  return result
}

export interface RememberedFilters {
  /**
   * The values to render and fetch with: whatever the URL carries, except on a visit that arrived
   * without any of this surface's remembered params, where the saved preferences fill in.
   */
  values: FilterParamValues
  /**
   * Stores this surface's params as they currently stand in the URL. Call it from a filter setter,
   * after that setter has written its param, so that only explicit user changes are remembered and
   * the whole set is captured (including a filter just returned to its default, which drops out).
   */
  save: () => void
}

/**
 * Remembers a filter surface's mode-like preferences across visits and app restarts, per user.
 *
 * `urlValues` names the surface's remembered params and supplies their current URL values; the
 * returned `values` are the ones to actually use. On a visit whose URL carries none of them, the
 * saved preferences are applied from the very first render — so the first fetch already uses them,
 * with no fetch-with-defaults-then-refetch — and a single history replace then writes them into the
 * URL, which keeps the address bar, sharing, and back/forward truthful without changing anything
 * the list is showing.
 *
 * Nothing is saved from URL-derived state: opening someone else's filtered link never overwrites
 * saved preferences. Saving happens only where a setter calls {@link RememberedFilters.save}, which
 * keeps the saved set equal to the URL's params from the user's first change onward. That equality
 * is why `values` reads through to the live saved set for the keys that seeded at mount: once the
 * user sets the last remembered filter back to its default, both the URL and the saved set are
 * empty, so nothing is re-applied behind them. Keys that did NOT seed at mount are never overlaid —
 * the storage is cross-tab reactive, and a preference saved in another tab must not refilter a list
 * sitting on a bare URL here (the loaded pages wouldn't be refetched, so old-filter and new-filter
 * pages would mix).
 */
export function useRememberedFilters(
  surface: FilterMemorySurface,
  urlValues: FilterParamValues,
): RememberedFilters {
  const [saved, setSaved] = useUserLocalStorageValue<FilterParamValues>(
    `gameListFilters:${surface}`,
    NO_VALUES,
    validateStoredValues,
  )

  const keys = Object.keys(urlValues)
  const savedForSurface = pickNonEmpty(saved, keys)

  // Decided once, at mount: `undefined` marks a visit whose URL was authoritative, anything else is
  // the set to seed. A lazy initializer runs at most once, so this never re-decides on a re-render.
  const [mountSeed] = useState<FilterParamValues | undefined>(() =>
    urlHasRememberedFilters(urlValues) ? undefined : savedForSurface,
  )

  useLayoutEffect(() => {
    if (!mountSeed || !urlHasRememberedFilters(mountSeed)) {
      return
    }

    // One replace for the whole set, pre-paint, preserving any params this surface doesn't
    // remember. The seeded values are what's being rendered already, so no filter appears to
    // change and nothing reloads.
    replace(window.location.pathname + withFilterParams(window.location.search, mountSeed))
  }, [mountSeed])

  const values =
    mountSeed && !urlHasRememberedFilters(urlValues)
      ? { ...urlValues, ...pickNonEmpty(saved, Object.keys(mountSeed)) }
      : urlValues

  const save = () => {
    const current = readFilterParams(window.location.search, keys)
    setSaved(Object.keys(current).length > 0 ? current : undefined)
  }

  return { values, save }
}
