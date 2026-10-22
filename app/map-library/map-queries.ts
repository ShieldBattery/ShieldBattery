import { LocalMapQuery, LocalMapSize, LocalMapSort } from '../../common/map-library'
import { escapeLike } from '../replay-library/replay-queries'
import { folderKey } from './map-folders'
import { normalizeSearch } from './map-summary'

/** A parameterized SQL statement (with `?` placeholders) over `map_files f`. */
export interface MapSqlQuery {
  /** The ordered select of one page. */
  sql: string
  /** A `COUNT(*)` over the same rows, ignoring paging. */
  countSql: string
  params: Array<string | number>
  /** `params` plus the page's limit and offset, for `sql`. */
  pageParams: Array<string | number>
}

/** The (exclusive lower, inclusive upper) bounds of a size class's larger dimension. */
const SIZE_BOUNDS: Readonly<Record<LocalMapSize, [number | undefined, number | undefined]>> = {
  [LocalMapSize.Tiny]: [undefined, 64],
  [LocalMapSize.Small]: [64, 96],
  [LocalMapSize.Medium]: [96, 128],
  [LocalMapSize.Large]: [128, 192],
  [LocalMapSize.Huge]: [192, undefined],
}

/**
 * The `ORDER BY` for a sort. Every one ends with `f.id` so pages never overlap or skip rows that
 * tie; files that couldn't be read as maps have no name and sort by their file name.
 */
function orderBy(sort: LocalMapSort): string {
  switch (sort) {
    case LocalMapSort.Name:
      return 'f.sort_name COLLATE NOCASE ASC, f.id ASC'
    case LocalMapSort.Players:
      return 'f.player_count IS NULL ASC, f.player_count ASC, f.sort_name COLLATE NOCASE ASC, f.id ASC'
    case LocalMapSort.Newest:
      return 'f.file_mtime DESC, f.id ASC'
    default:
      return sort satisfies never
  }
}

/**
 * Builds the query for a page of local map files. Filters on a map's facts leave out files that
 * couldn't be read as maps; the search and folder filters don't, since those only need the file.
 */
export function buildMapSqlQuery(query: LocalMapQuery): MapSqlQuery {
  const conditions: string[] = []
  const params: Array<string | number> = []

  const search = normalizeSearch(query.search ?? '')
  if (search) {
    // Normalizing leaves only letters, digits and single spaces, so there's nothing to escape
    conditions.push('(f.search_text LIKE ? OR f.search_compact LIKE ?)')
    params.push(`%${search}%`, `%${search.replaceAll(' ', '')}%`)
  }
  if (query.kind) {
    conditions.push('f.kind = ?')
    params.push(query.kind)
  }
  if (query.players?.length) {
    conditions.push(`f.player_count IN (${query.players.map(() => '?').join(', ')})`)
    params.push(...query.players)
  }
  if (query.sizes?.length) {
    const sizeConditions = query.sizes.map(size => {
      const [lower, upper] = SIZE_BOUNDS[size]
      const parts: string[] = []
      if (lower !== undefined) {
        parts.push('max(f.width, f.height) > ?')
        params.push(lower)
      }
      if (upper !== undefined) {
        parts.push('max(f.width, f.height) <= ?')
        params.push(upper)
      }
      return `(${parts.join(' AND ')})`
    })
    conditions.push(`(${sizeConditions.join(' OR ')})`)
  }
  if (query.tilesets?.length) {
    conditions.push(`f.tileset IN (${query.tilesets.map(() => '?').join(', ')})`)
    params.push(...query.tilesets)
  }
  if (query.eud !== undefined) {
    conditions.push('f.is_eud = ?')
    params.push(query.eud ? 1 : 0)
  }
  if (query.folder) {
    const key = folderKey(query.folder.path)
    if (query.folder.recursive) {
      conditions.push("(f.folder_key = ? OR f.folder_key LIKE ? ESCAPE '\\')")
      params.push(key, `${escapeLike(key)}/%`)
    } else {
      conditions.push('f.folder_key = ?')
      params.push(key)
    }
  }

  const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ''
  return {
    sql: `SELECT f.* FROM map_files f${where} ORDER BY ${orderBy(query.sort)} LIMIT ? OFFSET ?`,
    countSql: `SELECT COUNT(*) AS total FROM map_files f${where}`,
    params,
    pageParams: [...params, query.limit, query.offset],
  }
}
