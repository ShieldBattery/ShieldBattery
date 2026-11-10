import {
  MAP_PAGE_FILE_PARAM,
  mapFileIdFromSegment,
  MapPageSubPage,
  urlForMap,
} from '../../common/map-url'
import { makeMapFamilyId, SbMapId } from '../../common/maps'
import { encodePrettyId } from '../../common/pretty-id'

/** How many files a map's Files card shows before the rest are behind "Show all". */
export const FILES_COLLAPSED_ROWS = 5

/** What ordering a map's files and predicting which one players get needs to know about each. */
export interface FamilyFileFacts {
  id: SbMapId
  listed: boolean
  /** When the server first saw the file, as an ISO date string. */
  firstSeenAt: string
  /** Games in the last 28 days. */
  games28d: number
  /** Games ever. */
  gamesTotal: number
}

/** Newest first by when the server first saw them. */
function compareNewest(a: { firstSeenAt: string }, b: { firstSeenAt: string }): number {
  return Date.parse(b.firstSeenAt) - Date.parse(a.firstSeenAt)
}

/**
 * Orders a map's files for its Files card: the default (the file players get) first, then the
 * most played, then the newest.
 */
export function orderFamilyFiles<
  T extends Pick<FamilyFileFacts, 'id' | 'firstSeenAt' | 'gamesTotal'>,
>(files: ReadonlyArray<T>, currentId: SbMapId): T[] {
  return files.toSorted((a, b) => {
    if (a.id === currentId) {
      return -1
    } else if (b.id === currentId) {
      return 1
    }
    return b.gamesTotal - a.gamesTotal || compareNewest(a, b)
  })
}

/**
 * The rows of a map's Files card: every file when expanded, otherwise the first
 * {@link FILES_COLLAPSED_ROWS}, plus the selected file if it would be hidden (so the file being
 * viewed is always in the list).
 */
export function visibleFamilyFiles<T extends { id: SbMapId }>(
  ordered: ReadonlyArray<T>,
  selectedId: SbMapId,
  expanded: boolean,
): { rows: T[]; hiddenCount: number } {
  if (expanded || ordered.length <= FILES_COLLAPSED_ROWS) {
    return { rows: [...ordered], hiddenCount: 0 }
  }
  const rows = ordered.slice(0, FILES_COLLAPSED_ROWS)
  const selectedIndex = ordered.findIndex(f => f.id === selectedId)
  if (selectedIndex >= FILES_COLLAPSED_ROWS) {
    rows.push(ordered[selectedIndex])
  }
  return { rows, hiddenCount: ordered.length - rows.length }
}

/**
 * The share of 28-day games by which a challenger has to lead a derived current file, and the
 * number of games it has to lead by, before it takes over. Keep in sync with
 * `refresh_map_families` in the migrations.
 */
const SWITCH_LEAD_RATIO = 1.25
const SWITCH_LEAD_GAMES = 10

/**
 * Predicts the file players will get for a map holding `files`, the same way the server picks it:
 * staff's `defaultMapId` while it's eligible, otherwise the most played eligible file (in the last
 * 28 days, then ever), then the newest. A file is eligible when it's listed, or when none of the
 * map's files are. With `keepCurrent`, an eligible `incumbentId` stays unless the most played file
 * leads it by a clear margin. The server's stats can be newer than the client's, so this is a
 * prediction.
 */
export function predictCurrentFile(
  files: ReadonlyArray<FamilyFileFacts>,
  {
    defaultMapId,
    incumbentId,
    keepCurrent,
  }: { defaultMapId?: SbMapId; incumbentId?: SbMapId; keepCurrent: boolean },
): SbMapId | undefined {
  const anyListed = files.some(f => f.listed)
  const eligible = files.filter(f => f.listed || !anyListed)
  if (defaultMapId && eligible.some(f => f.id === defaultMapId)) {
    return defaultMapId
  }

  const derived = eligible.toSorted(
    (a, b) =>
      b.games28d - a.games28d ||
      b.gamesTotal - a.gamesTotal ||
      compareNewest(a, b) ||
      (a.id < b.id ? -1 : 1),
  )[0]
  if (!derived) {
    return undefined
  }
  const incumbent = keepCurrent ? eligible.find(f => f.id === incumbentId) : undefined
  if (
    incumbent &&
    !(
      derived.games28d >= incumbent.games28d * SWITCH_LEAD_RATIO &&
      derived.games28d - incumbent.games28d >= SWITCH_LEAD_GAMES
    )
  ) {
    return incumbent.id
  }
  return derived.id
}

/** What a map page has loaded so far about the file its URL selects. */
export type SelectedFileState =
  /** The page is still loading the file named by the URL's `file` param. */
  | { kind: 'loading' }
  /** The `file` param names no file. */
  | { kind: 'missing' }
  /** The file the `file` param names, and the map it's in. */
  | { kind: 'found'; id: SbMapId; family: { id: string; name: string } }

/**
 * Returns the URL a map page should replace its URL with, or undefined if it's already right. The
 * right URL is the map's own id and slug, the sub-page if it's a known one, and the selected file
 * as the `file` param: the file the path's id named (when it was a file's id rather than the map's),
 * otherwise the file the `file` param named. A `file` param that names no file is dropped, and one
 * naming a file of another map leads to that map's page. Other query params are kept.
 */
export function correctedMapPageUrl({
  pathname,
  search,
  subPage,
  family,
  pathFileId,
  paramFile,
}: {
  pathname: string
  search: string
  subPage: MapPageSubPage | undefined
  family: { id: string; name: string }
  /** The file the path's id named, if it named one. */
  pathFileId: SbMapId | undefined
  /** What's known about the file the `file` param names. Ignored without a `file` param. */
  paramFile: SelectedFileState | undefined
}): string | undefined {
  const params = new URLSearchParams(search)
  const rawFileParam = params.get(MAP_PAGE_FILE_PARAM)

  let target = family
  let fileId: SbMapId | undefined
  if (pathFileId) {
    fileId = pathFileId
  } else if (rawFileParam) {
    const parsed = mapFileIdFromSegment(rawFileParam)
    if (parsed) {
      if (!paramFile || paramFile.kind === 'loading') {
        return undefined
      }
      if (paramFile.kind === 'found') {
        fileId = paramFile.id
        target = paramFile.family
      }
    }
  }

  if (fileId) {
    params.set(MAP_PAGE_FILE_PARAM, encodePrettyId(fileId))
  } else {
    params.delete(MAP_PAGE_FILE_PARAM)
  }
  const correctedPath = urlForMap(makeMapFamilyId(target.id), target.name, subPage)
  const correctedSearch = params.toString()
  const corrected = correctedPath + (correctedSearch ? `?${correctedSearch}` : '')

  const current = pathname + search
  return corrected !== current ? corrected : undefined
}

/**
 * Returns the URL of a map's page with one of its files selected. The default file is the page's
 * own selection, so selecting it leaves the `file` param out.
 */
export function urlForMapFile(
  family: { id: string; name: string; current: { id: SbMapId } },
  fileId: SbMapId,
  subPage?: MapPageSubPage,
): string {
  return urlForMap(
    makeMapFamilyId(family.id),
    family.name,
    subPage,
    fileId === family.current.id ? undefined : fileId,
  )
}
