import { MapCatalogTab } from '../../common/map-url'
import { ALL_TILESETS, Tileset } from '../../common/maps'
import { EudFilter, MapFilter, MapLens, MapSizeClass, MapSort } from '../gql/graphql'

/** The order the catalog lists maps in, as offered to the viewer. */
export enum CatalogSort {
  Trending = 'trending',
  MostPlayed = 'played',
  Newest = 'newest',
  Name = 'name',
  /** Only offered while searching. */
  BestMatch = 'match',
}

/** The sorts offered while not searching, in display order. */
export const BROWSE_SORTS: ReadonlyArray<CatalogSort> = [
  CatalogSort.Trending,
  CatalogSort.MostPlayed,
  CatalogSort.Newest,
  CatalogSort.Name,
]

export const ALL_CATALOG_SORTS: ReadonlyArray<CatalogSort> = Object.values(CatalogSort)

export function catalogSortToMapSort(sort: CatalogSort): MapSort {
  switch (sort) {
    case CatalogSort.Trending:
      return MapSort.Trending
    case CatalogSort.MostPlayed:
      return MapSort.PopularAllTime
    case CatalogSort.Newest:
      return MapSort.Newest
    case CatalogSort.Name:
      return MapSort.Name
    case CatalogSort.BestMatch:
      return MapSort.Relevance
    default:
      return sort satisfies never
  }
}

/** The sort a tab uses when neither the URL nor the viewer's saved default picks one. */
export function defaultSortForTab(tab: MapCatalogTab): CatalogSort {
  return tab === MapCatalogTab.All ? CatalogSort.Trending : CatalogSort.Newest
}

/** The player-count choices, as offered to the viewer. */
export enum CatalogPlayers {
  Two = '2',
  Three = '3',
  Four = '4',
  FivePlus = '5+',
}

export const ALL_CATALOG_PLAYERS: ReadonlyArray<CatalogPlayers> = Object.values(CatalogPlayers)

function playersToCounts(players: CatalogPlayers): number[] {
  switch (players) {
    case CatalogPlayers.Two:
      return [2]
    case CatalogPlayers.Three:
      return [3]
    case CatalogPlayers.Four:
      return [4]
    case CatalogPlayers.FivePlus:
      return [5, 6, 7, 8]
    default:
      return players satisfies never
  }
}

export const ALL_MAP_SIZE_CLASSES: ReadonlyArray<MapSizeClass> = [
  MapSizeClass.Tiny,
  MapSizeClass.Small,
  MapSizeClass.Medium,
  MapSizeClass.Large,
  MapSizeClass.Huge,
]

const SIZE_SLUGS: ReadonlyMap<MapSizeClass, string> = new Map([
  [MapSizeClass.Tiny, 'tiny'],
  [MapSizeClass.Small, 'small'],
  [MapSizeClass.Medium, 'medium'],
  [MapSizeClass.Large, 'large'],
  [MapSizeClass.Huge, 'huge'],
])

const TILESET_SLUGS: ReadonlyMap<Tileset, string> = new Map([
  [Tileset.Badlands, 'badlands'],
  [Tileset.Platform, 'platform'],
  [Tileset.Installation, 'installation'],
  [Tileset.Ashworld, 'ashworld'],
  [Tileset.Jungle, 'jungle'],
  [Tileset.Desert, 'desert'],
  [Tileset.Ice, 'ice'],
  [Tileset.Twilight, 'twilight'],
])

/** URL slugs of the lenses other than the default (all maps). */
const LENS_SLUGS: ReadonlyMap<MapLens, string> = new Map([
  [MapLens.Melee, 'melee'],
  [MapLens.Ums, 'ums'],
])

/** URL slugs of the EUD filters other than the default (show them). */
const EUD_SLUGS: ReadonlyMap<EudFilter, string> = new Map([
  [EudFilter.Exclude, 'hide'],
  [EudFilter.Only, 'only'],
])

/** Returns the value whose slug is `slug`, if any. */
function fromSlug<T>(slug: string | null, bySlug: ReadonlyMap<T, string>): T | undefined {
  return Array.from(bySlug.entries()).find(([, s]) => s === slug)?.[0]
}

/** Filters that apply to every catalog tab alike, and are saved as the viewer's defaults. */
export interface CatalogFilters {
  lens: MapLens
  players?: CatalogPlayers
  sizes: ReadonlyArray<MapSizeClass>
  tilesets: ReadonlyArray<Tileset>
  eud: EudFilter
  official: boolean
}

export const DEFAULT_CATALOG_FILTERS: CatalogFilters = {
  lens: MapLens.All,
  players: undefined,
  sizes: [],
  tilesets: [],
  eud: EudFilter.Any,
  official: false,
}

/** Everything the catalog's URL search string describes. */
export interface CatalogParams extends CatalogFilters {
  search: string
  /** The sort picked in the URL, if any (see {@link effectiveSort}). */
  sort?: CatalogSort
}

export function hasNonDefaultFilters(filters: CatalogFilters): boolean {
  return (
    filters.lens !== MapLens.All ||
    filters.players !== undefined ||
    filters.sizes.length > 0 ||
    filters.tilesets.length > 0 ||
    filters.eud !== EudFilter.Any ||
    filters.official
  )
}

/** The names of the search params the catalog reads. */
const PARAM_NAMES = ['q', 'sort', 'lens', 'players', 'size', 'tileset', 'eud', 'official']

/** Whether `search` sets any of the catalog's params. */
export function hasCatalogParams(search: URLSearchParams): boolean {
  return PARAM_NAMES.some(name => search.has(name))
}

function parseList<T>(value: string | null, bySlug: ReadonlyMap<T, string>): T[] {
  if (!value) {
    return []
  }
  const slugs = new Set(value.split(','))
  // Kept in the canonical order rather than the URL's, so equivalent URLs give equal params
  return Array.from(bySlug.entries())
    .filter(([, slug]) => slugs.has(slug))
    .map(([item]) => item)
}

/** Reads the catalog's params from a URL search string. Unknown values fall back to defaults. */
export function parseCatalogParams(search: URLSearchParams): CatalogParams {
  const playersParam = search.get('players')
  const sortParam = search.get('sort')
  return {
    search: search.get('q') ?? '',
    sort: ALL_CATALOG_SORTS.includes(sortParam as CatalogSort)
      ? (sortParam as CatalogSort)
      : undefined,
    lens: fromSlug(search.get('lens'), LENS_SLUGS) ?? MapLens.All,
    players: ALL_CATALOG_PLAYERS.includes(playersParam as CatalogPlayers)
      ? (playersParam as CatalogPlayers)
      : undefined,
    sizes: parseList(search.get('size'), SIZE_SLUGS),
    tilesets: parseList(search.get('tileset'), TILESET_SLUGS),
    eud: fromSlug(search.get('eud'), EUD_SLUGS) ?? EudFilter.Any,
    official: search.get('official') === '1',
  }
}

/**
 * Writes the catalog's params as a URL search string (without the `?`), leaving out every value
 * that matches the defaults. Other params already in `base` are kept.
 */
export function serializeCatalogParams(
  params: CatalogParams,
  base: URLSearchParams = new URLSearchParams(),
): string {
  const search = new URLSearchParams(base)
  const set = (name: string, value: string | undefined) => {
    if (value) {
      search.set(name, value)
    } else {
      search.delete(name)
    }
  }

  set('q', params.search)
  set('sort', params.sort)
  set('lens', LENS_SLUGS.get(params.lens))
  set('players', params.players)
  set('size', params.sizes.map(s => SIZE_SLUGS.get(s)).join(','))
  set(
    'tileset',
    ALL_TILESETS.filter(t => params.tilesets.includes(t))
      .map(t => TILESET_SLUGS.get(t))
      .join(','),
  )
  set('eud', EUD_SLUGS.get(params.eud))
  set('official', params.official ? '1' : undefined)
  // Commas are legal in a query string, and keep shared links readable (`size=small,huge`)
  return search.toString().replaceAll('%2C', ',')
}

/** The params with only the filters taken from `params`, for saving as the viewer's defaults. */
export function filtersOf(params: CatalogFilters): CatalogFilters {
  return {
    lens: params.lens,
    players: params.players,
    sizes: params.sizes,
    tilesets: params.tilesets,
    eud: params.eud,
    official: params.official,
  }
}

/**
 * The sort the listing uses: the URL's, else Best match while searching, else the viewer's saved
 * sort for the tab, else the tab's default. Best match only applies while searching.
 */
export function effectiveSort(
  params: Pick<CatalogParams, 'search' | 'sort'>,
  savedSort: CatalogSort | undefined,
  tab: MapCatalogTab,
): CatalogSort {
  const searching = !!params.search.trim()
  if (params.sort && (searching || params.sort !== CatalogSort.BestMatch)) {
    return params.sort
  }
  if (searching) {
    return CatalogSort.BestMatch
  }
  return savedSort && savedSort !== CatalogSort.BestMatch ? savedSort : defaultSortForTab(tab)
}

/** The GraphQL filter for the params. */
export function toMapFilter(params: CatalogParams): MapFilter {
  const search = params.search.trim()
  return {
    search: search || undefined,
    lens: params.lens,
    players: params.players ? playersToCounts(params.players) : undefined,
    sizes: params.sizes.length ? [...params.sizes] : undefined,
    tilesets: params.tilesets.length ? [...params.tilesets] : undefined,
    eud: params.eud,
    official: params.official || undefined,
  }
}

/**
 * Validates saved filter defaults read from local storage, which may have been written by an
 * older version of the app or edited by hand.
 */
export function validateSavedFilters(value: unknown): CatalogFilters | undefined {
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const v = value as Record<string, unknown>
  const lens = Object.values(MapLens).includes(v.lens as MapLens) ? (v.lens as MapLens) : undefined
  const eud = Object.values(EudFilter).includes(v.eud as EudFilter)
    ? (v.eud as EudFilter)
    : undefined
  return {
    lens: lens ?? MapLens.All,
    players: ALL_CATALOG_PLAYERS.includes(v.players as CatalogPlayers)
      ? (v.players as CatalogPlayers)
      : undefined,
    sizes: Array.isArray(v.sizes)
      ? ALL_MAP_SIZE_CLASSES.filter(s => (v.sizes as unknown[]).includes(s))
      : [],
    tilesets: Array.isArray(v.tilesets)
      ? ALL_TILESETS.filter(t => (v.tilesets as unknown[]).includes(t))
      : [],
    eud: eud ?? EudFilter.Any,
    official: v.official === true,
  }
}

export function validateSavedSort(value: unknown): CatalogSort | undefined {
  return BROWSE_SORTS.includes(value as CatalogSort) ? (value as CatalogSort) : undefined
}
