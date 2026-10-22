import { describe, expect, test } from 'vitest'
import { LocalMapKind, LocalMapSize, LocalMapSort } from '../../common/map-library'
import { buildMapSqlQuery } from './map-queries'

const PAGE = { sort: LocalMapSort.Name, offset: 0, limit: 200 }

describe('app/map-library/map-queries', () => {
  test('lists every file by name with no filters', () => {
    const query = buildMapSqlQuery(PAGE)
    expect(query.sql).toBe(
      'SELECT f.* FROM map_files f ORDER BY f.sort_name COLLATE NOCASE ASC, f.id ASC LIMIT ? OFFSET ?',
    )
    expect(query.countSql).toBe('SELECT COUNT(*) AS total FROM map_files f')
    expect(query.params).toEqual([])
    expect(query.pageParams).toEqual([200, 0])
  })

  test('searches normalized names, with and without spaces', () => {
    const query = buildMapSqlQuery({ ...PAGE, search: 'Lost  Temple!' })
    expect(query.sql).toContain('(f.search_text LIKE ? OR f.search_compact LIKE ?)')
    expect(query.params).toEqual(['%lost temple%', '%losttemple%'])
  })

  test('a search with nothing searchable in it is no search', () => {
    expect(buildMapSqlQuery({ ...PAGE, search: '%_ !' }).params).toEqual([])
  })

  test('filters on the map facts', () => {
    const query = buildMapSqlQuery({
      ...PAGE,
      kind: LocalMapKind.Ums,
      players: [2, 4],
      sizes: [LocalMapSize.Tiny, LocalMapSize.Large],
      tilesets: [4],
      eud: false,
    })
    expect(query.sql).toContain(
      'WHERE f.kind = ? AND f.player_count IN (?, ?) AND ' +
        '((max(f.width, f.height) <= ?) OR ' +
        '(max(f.width, f.height) > ? AND max(f.width, f.height) <= ?)) ' +
        'AND f.tileset IN (?) AND f.is_eud = ?',
    )
    expect(query.params).toEqual(['ums', 2, 4, 64, 128, 192, 4, 0])
  })

  test('matches a folder directly or with everything beneath it, ignoring case', () => {
    const direct = buildMapSqlQuery({
      ...PAGE,
      folder: { path: 'documents/Download', recursive: false },
    })
    expect(direct.sql).toContain('WHERE f.folder_key = ?')
    expect(direct.params).toEqual(['documents/download'])

    const recursive = buildMapSqlQuery({
      ...PAGE,
      folder: { path: 'documents/UMS_old', recursive: true },
    })
    expect(recursive.sql).toContain("(f.folder_key = ? OR f.folder_key LIKE ? ESCAPE '\\')")
    expect(recursive.params).toEqual(['documents/ums_old', 'documents/ums\\_old/%'])
  })

  test('every sort ends in the id', () => {
    for (const sort of Object.values(LocalMapSort)) {
      expect(buildMapSqlQuery({ ...PAGE, sort }).sql).toMatch(/f\.id ASC LIMIT \? OFFSET \?$/)
    }
  })
})
