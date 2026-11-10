import { describe, expect, test } from 'vitest'
import { MapPageSubPage, mapSlug, urlForMapCompare } from '../../common/map-url'
import { makeSbMapId, SbMapId } from '../../common/maps'
import { encodePrettyId } from '../../common/pretty-id'
import {
  correctedMapPageUrl,
  duplicateFileNames,
  FamilyFileFacts,
  FILES_COLLAPSED_ROWS,
  orderFamilyFiles,
  predictCurrentFile,
  sameMapReportCompareUrl,
  urlForMapFile,
  visibleFamilyFiles,
  wrongMapReportCompareUrl,
} from './map-family-files'

function fileId(n: number): SbMapId {
  return makeSbMapId(`5eed0000-0000-0000-0000-${n.toString().padStart(12, '0')}`)
}

function file(n: number, facts: Partial<FamilyFileFacts> = {}): FamilyFileFacts {
  return {
    id: fileId(n),
    listed: true,
    firstSeenAt: '2026-01-01T00:00:00.000Z',
    games28d: 0,
    gamesTotal: 0,
    ...facts,
  }
}

const FAMILY = { id: '5eed0000-0000-0000-0000-00000000ffff', name: 'Big Game Hunters' }
const OTHER_FAMILY = { id: '5eed0000-0000-0000-0000-00000000eeee', name: 'Fighting Spirit' }
const FAMILY_PATH = `/maps/${encodePrettyId(FAMILY.id)}/${mapSlug(FAMILY.name)}`

describe('maps/map-family-files/orderFamilyFiles', () => {
  test('puts the default first, then the most played, then the newest', () => {
    const files = [
      file(1, { gamesTotal: 5 }),
      file(2, { gamesTotal: 50 }),
      file(3, { gamesTotal: 5, firstSeenAt: '2026-06-01T00:00:00.000Z' }),
      file(4, { gamesTotal: 1 }),
    ]
    expect(orderFamilyFiles(files, fileId(4)).map(f => f.id)).toEqual([
      fileId(4),
      fileId(2),
      fileId(3),
      fileId(1),
    ])
  })

  test("doesn't change the list it's given", () => {
    const files = [file(1), file(2, { gamesTotal: 3 })]
    orderFamilyFiles(files, fileId(1))
    expect(files.map(f => f.id)).toEqual([fileId(1), fileId(2)])
  })
})

describe('maps/map-family-files/visibleFamilyFiles', () => {
  const many = Array.from({ length: FILES_COLLAPSED_ROWS + 3 }, (_, i) => file(i + 1))

  test('shows every file of a short list', () => {
    const few = many.slice(0, FILES_COLLAPSED_ROWS)
    expect(visibleFamilyFiles(few, fileId(1), false)).toEqual({ rows: few, hiddenCount: 0 })
  })

  test('collapses a long list', () => {
    const result = visibleFamilyFiles(many, fileId(1), false)
    expect(result.rows).toEqual(many.slice(0, FILES_COLLAPSED_ROWS))
    expect(result.hiddenCount).toBe(3)
  })

  test('keeps the selected file in a collapsed list', () => {
    const selected = many[many.length - 1]
    const result = visibleFamilyFiles(many, selected.id, false)
    expect(result.rows).toEqual([...many.slice(0, FILES_COLLAPSED_ROWS), selected])
    expect(result.hiddenCount).toBe(2)
  })

  test('shows everything when expanded', () => {
    expect(visibleFamilyFiles(many, fileId(1), true)).toEqual({ rows: many, hiddenCount: 0 })
  })
})

describe('maps/map-family-files/predictCurrentFile', () => {
  test("uses staff's pick while it's eligible", () => {
    const files = [file(1, { games28d: 100 }), file(2)]
    expect(predictCurrentFile(files, { defaultMapId: fileId(2), keepCurrent: true })).toBe(
      fileId(2),
    )
  })

  test('ignores an unlisted pick while another file is listed', () => {
    const files = [file(1, { games28d: 1 }), file(2, { listed: false, games28d: 100 })]
    expect(predictCurrentFile(files, { defaultMapId: fileId(2), keepCurrent: false })).toBe(
      fileId(1),
    )
  })

  test('picks among unlisted files when none is listed', () => {
    const files = [file(1, { listed: false }), file(2, { listed: false, games28d: 3 })]
    expect(predictCurrentFile(files, { keepCurrent: false })).toBe(fileId(2))
  })

  test('derives by 28-day games, then all-time games, then the newest', () => {
    expect(
      predictCurrentFile([file(1, { games28d: 2 }), file(2, { games28d: 3 })], {
        keepCurrent: false,
      }),
    ).toBe(fileId(2))
    expect(
      predictCurrentFile([file(1, { gamesTotal: 9 }), file(2, { gamesTotal: 3 })], {
        keepCurrent: false,
      }),
    ).toBe(fileId(1))
    expect(
      predictCurrentFile([file(1), file(2, { firstSeenAt: '2026-03-01T00:00:00.000Z' })], {
        keepCurrent: false,
      }),
    ).toBe(fileId(2))
  })

  test('keeps the incumbent unless it is clearly beaten', () => {
    const close = [file(1, { games28d: 20 }), file(2, { games28d: 24 })]
    expect(predictCurrentFile(close, { incumbentId: fileId(1), keepCurrent: true })).toBe(fileId(1))
    // 25% more but fewer than 10 games more
    const small = [file(1, { games28d: 4 }), file(2, { games28d: 8 })]
    expect(predictCurrentFile(small, { incumbentId: fileId(1), keepCurrent: true })).toBe(fileId(1))
    const clear = [file(1, { games28d: 20 }), file(2, { games28d: 30 })]
    expect(predictCurrentFile(clear, { incumbentId: fileId(1), keepCurrent: true })).toBe(fileId(2))
  })

  test('ignores the incumbent without keepCurrent or once it is gone', () => {
    const files = [file(1, { games28d: 20 }), file(2, { games28d: 24 })]
    expect(predictCurrentFile(files, { incumbentId: fileId(1), keepCurrent: false })).toBe(
      fileId(2),
    )
    expect(predictCurrentFile(files, { incumbentId: fileId(9), keepCurrent: true })).toBe(fileId(2))
  })

  test('has nothing to predict for no files', () => {
    expect(predictCurrentFile([], { keepCurrent: true })).toBeUndefined()
  })
})

describe('maps/map-family-files/correctedMapPageUrl', () => {
  const base = {
    subPage: undefined,
    family: FAMILY,
    pathFileId: undefined,
    paramFile: undefined,
  }

  test('leaves a correct URL alone', () => {
    expect(correctedMapPageUrl({ ...base, pathname: FAMILY_PATH, search: '' })).toBeUndefined()
  })

  test('fixes the id, slug and sub-page', () => {
    expect(
      correctedMapPageUrl({ ...base, pathname: `/maps/${FAMILY.id}/wrong/nope`, search: '' }),
    ).toBe(FAMILY_PATH)
    expect(
      correctedMapPageUrl({
        ...base,
        subPage: MapPageSubPage.Games,
        pathname: `/maps/${encodePrettyId(FAMILY.id)}/x/games`,
        search: '',
      }),
    ).toBe(`${FAMILY_PATH}/games`)
  })

  test("moves a file's id from the path to the file param", () => {
    expect(
      correctedMapPageUrl({
        ...base,
        pathname: `/maps/${encodePrettyId(fileId(1))}/whatever`,
        search: '?other=1',
        pathFileId: fileId(1),
      }),
    ).toBe(`${FAMILY_PATH}?other=1&file=${encodePrettyId(fileId(1))}`)
  })

  test('waits for the file param to load', () => {
    expect(
      correctedMapPageUrl({
        ...base,
        pathname: `/maps/${FAMILY.id}/x`,
        search: `?file=${encodePrettyId(fileId(1))}`,
        paramFile: { kind: 'loading' },
      }),
    ).toBeUndefined()
  })

  test('keeps a file param naming a file of the map, in its pretty form', () => {
    const search = `?file=${encodePrettyId(fileId(1))}`
    const found = { kind: 'found', id: fileId(1), family: FAMILY } as const
    expect(
      correctedMapPageUrl({ ...base, pathname: FAMILY_PATH, search, paramFile: found }),
    ).toBeUndefined()
    expect(
      correctedMapPageUrl({
        ...base,
        pathname: FAMILY_PATH,
        search: `?file=${fileId(1)}`,
        paramFile: found,
      }),
    ).toBe(FAMILY_PATH + search)
  })

  test('drops a file param naming no file', () => {
    expect(
      correctedMapPageUrl({
        ...base,
        pathname: FAMILY_PATH,
        search: `?file=${encodePrettyId(fileId(1))}`,
        paramFile: { kind: 'missing' },
      }),
    ).toBe(FAMILY_PATH)
    expect(correctedMapPageUrl({ ...base, pathname: FAMILY_PATH, search: '?file=nonsense' })).toBe(
      FAMILY_PATH,
    )
  })

  test("follows a file param to the file's own map", () => {
    expect(
      correctedMapPageUrl({
        ...base,
        pathname: FAMILY_PATH,
        search: `?file=${encodePrettyId(fileId(1))}`,
        paramFile: { kind: 'found', id: fileId(1), family: OTHER_FAMILY },
      }),
    ).toBe(
      `/maps/${encodePrettyId(OTHER_FAMILY.id)}/${mapSlug(OTHER_FAMILY.name)}` +
        `?file=${encodePrettyId(fileId(1))}`,
    )
  })
})

describe('maps/map-family-files/urlForMapFile', () => {
  const family = { ...FAMILY, current: { id: fileId(1) } }

  test('leaves the default file out of the URL', () => {
    expect(urlForMapFile(family, fileId(1))).toBe(FAMILY_PATH)
  })

  test('selects any other file', () => {
    expect(urlForMapFile(family, fileId(2))).toBe(
      `${FAMILY_PATH}?file=${encodePrettyId(fileId(2))}`,
    )
  })
})

describe('duplicateFileNames', () => {
  test('finds names shared by several files', () => {
    expect(duplicateFileNames([{ name: 'Fighting Spirit' }, { name: 'Fighting Spirit' }])).toEqual(
      new Set(['Fighting Spirit']),
    )
  })

  test('compares names without color codes', () => {
    expect(duplicateFileNames([{ name: 'Fighting Spirit' }, { name: 'Fighting Spirit' }])).toEqual(
      new Set(['Fighting Spirit']),
    )
  })

  test('is empty when every name is different', () => {
    expect(
      duplicateFileNames([{ name: 'Fighting Spirit' }, { name: 'Fighting Spirit 2' }]).size,
    ).toBe(0)
  })
})

describe('wrongMapReportCompareUrl', () => {
  const family = { current: { id: fileId(1) }, files: [{ id: fileId(1) }, { id: fileId(2) }] }

  test('compares the reported file with the default', () => {
    expect(wrongMapReportCompareUrl(family, fileId(2))).toBe(urlForMapCompare(fileId(1), fileId(2)))
  })

  test('compares a reported default with the first other file', () => {
    expect(wrongMapReportCompareUrl(family, fileId(1))).toBe(urlForMapCompare(fileId(1), fileId(2)))
  })

  test('carries the report to review', () => {
    expect(wrongMapReportCompareUrl(family, fileId(2), 'r1')).toBe(
      urlForMapCompare(fileId(1), fileId(2), undefined, 'r1'),
    )
  })

  test('has no URL when the reported default is the only file', () => {
    expect(
      wrongMapReportCompareUrl(
        { current: { id: fileId(1) }, files: [{ id: fileId(1) }] },
        fileId(1),
      ),
    ).toBeUndefined()
  })
})

describe('sameMapReportCompareUrl', () => {
  test('compares the two maps defaults', () => {
    expect(
      sameMapReportCompareUrl({ current: { id: fileId(1) } }, { current: { id: fileId(3) } }),
    ).toBe(urlForMapCompare(fileId(1), fileId(3)))
  })

  test('carries the report to review', () => {
    expect(
      sameMapReportCompareUrl({ current: { id: fileId(1) } }, { current: { id: fileId(3) } }, 'r1'),
    ).toBe(urlForMapCompare(fileId(1), fileId(3), undefined, 'r1'))
  })
})
