import { beforeEach, describe, expect, test, vi } from 'vitest'
import { makeMapFamilyId, makeSbMapId, MapInfo, MapVisibility, Tileset } from '../../../common/maps'
import { encodePrettyId } from '../../../common/pretty-id'
import { asMockedFunction } from '../../../common/testing/mocks'
import { PageMetadataContext } from '../page-metadata/types'
import { getMapInfos, resolveMapId, resolveMapPageId } from './map-models'
import { mapComparePageMetadata, mapPageMetadata } from './map-page-meta'

vi.mock('./map-models', () => ({
  getMapInfos: vi.fn(),
  resolveMapId: vi.fn(),
  resolveMapPageId: vi.fn(),
}))

const getMapInfosMock = asMockedFunction(getMapInfos)
const resolveMapIdMock = asMockedFunction(resolveMapId)
const resolveMapPageIdMock = asMockedFunction(resolveMapPageId)

const CONTEXT: PageMetadataContext = {
  canonicalHost: 'https://shieldbattery.net',
  publicAssetsUrl: 'https://cdn.example.com/public/',
}

const FAMILY_ID = makeMapFamilyId('5eed0000-0000-0000-0000-00000000ffff')
const MAP_ID = makeSbMapId('5eed0000-0000-0000-0000-00000000aaaa')
const ALIAS_ID = makeSbMapId('5eed0000-0000-0000-0000-00000000bbbb')
const OLD_FILE_ID = makeSbMapId('5eed0000-0000-0000-0000-00000000dddd')

function makeMap(overrides: Partial<MapInfo> = {}): MapInfo {
  return {
    id: MAP_ID,
    name: 'Polypoid 1.75',
    description: 'The modern four-player standard.',
    visibility: MapVisibility.Public,
    jpegImageUrl: 'https://cdn.example.com/maps/polypoid-1024.jpg',
    mapData: {
      slots: 4,
      tileset: Tileset.Jungle,
      umsContent: false,
    },
    ...overrides,
  } as MapInfo
}

const FAMILY_URL = `https://shieldbattery.net/maps/${encodePrettyId(FAMILY_ID)}/polypoid-1-75`

describe('maps/map-page-meta', () => {
  beforeEach(() => {
    getMapInfosMock.mockReset()
    resolveMapIdMock.mockReset()
    resolveMapIdMock.mockImplementation(async id => id)
    resolveMapPageIdMock.mockReset()
    resolveMapPageIdMock.mockResolvedValue({
      familyId: FAMILY_ID,
      currentMapId: MAP_ID,
      listed: true,
    })
  })

  test('builds metadata for a listed map from its current file', async () => {
    getMapInfosMock.mockResolvedValueOnce([makeMap()])

    const result = await mapPageMetadata({ id: encodePrettyId(FAMILY_ID) }, CONTEXT)

    expect(resolveMapPageIdMock).toHaveBeenCalledWith(FAMILY_ID)
    expect(getMapInfosMock).toHaveBeenCalledWith([MAP_ID, MAP_ID])
    expect(result).toEqual({
      url: FAMILY_URL,
      type: 'website',
      title: 'Polypoid 1.75',
      description: 'The modern four-player standard.',
      image: 'https://cdn.example.com/maps/polypoid-1024.jpg',
      noindex: false,
    })
  })

  test('accepts a raw UUID and points the canonical URL at the family of an alias', async () => {
    getMapInfosMock.mockResolvedValueOnce([makeMap()])

    const result = await mapPageMetadata({ id: ALIAS_ID }, CONTEXT)

    expect(resolveMapPageIdMock).toHaveBeenCalledWith(ALIAS_ID)
    expect(result?.url).toBe(FAMILY_URL)
  })

  test("describes a file named by its id, canonical to its family's page", async () => {
    resolveMapPageIdMock.mockResolvedValueOnce({
      familyId: FAMILY_ID,
      currentMapId: MAP_ID,
      listed: true,
      fileId: OLD_FILE_ID,
    })
    getMapInfosMock.mockResolvedValueOnce([
      makeMap(),
      makeMap({ id: OLD_FILE_ID, name: 'Polypoid 1.65', jpegImageUrl: 'https://x/165.jpg' }),
    ])

    const result = await mapPageMetadata({ id: encodePrettyId(OLD_FILE_ID) }, CONTEXT)

    expect(getMapInfosMock).toHaveBeenCalledWith([MAP_ID, OLD_FILE_ID])
    expect(result?.title).toBe('Polypoid 1.65')
    expect(result?.image).toBe('https://x/165.jpg')
    // The slug follows the map's name, which is its current file's
    expect(result?.url).toBe(FAMILY_URL)
    expect(result?.noindex).toBe(false)
  })

  test('selects an unlisted file in the canonical URL and keeps it out of search engines', async () => {
    resolveMapPageIdMock.mockResolvedValueOnce({
      familyId: FAMILY_ID,
      currentMapId: MAP_ID,
      listed: true,
      fileId: OLD_FILE_ID,
    })
    getMapInfosMock.mockResolvedValueOnce([
      makeMap(),
      makeMap({ id: OLD_FILE_ID, visibility: MapVisibility.Unlisted }),
    ])

    const result = await mapPageMetadata({ id: OLD_FILE_ID }, CONTEXT)

    expect(result?.url).toBe(`${FAMILY_URL}?file=${encodePrettyId(OLD_FILE_ID)}`)
    expect(result?.noindex).toBe(true)
  })

  test('keeps unlisted maps out of search engines', async () => {
    resolveMapPageIdMock.mockResolvedValueOnce({
      familyId: FAMILY_ID,
      currentMapId: MAP_ID,
      listed: false,
    })
    getMapInfosMock.mockResolvedValueOnce([makeMap({ visibility: MapVisibility.Unlisted })])

    const result = await mapPageMetadata({ id: encodePrettyId(FAMILY_ID) }, CONTEXT)

    expect(result?.url).toBe(FAMILY_URL)
    expect(result?.noindex).toBe(true)
  })

  test('strips color codes and describes maps without a description', async () => {
    getMapInfosMock.mockResolvedValueOnce([
      makeMap({ name: '\x03Lost \x04Temple', description: '  \x05 ' }),
    ])

    const result = await mapPageMetadata({ id: encodePrettyId(FAMILY_ID) }, CONTEXT)

    expect(result?.title).toBe('Lost Temple')
    expect(result?.description).toBe('A 4-player Jungle world melee map. Play it on ShieldBattery.')
  })

  test('truncates long descriptions', async () => {
    getMapInfosMock.mockResolvedValueOnce([makeMap({ description: 'a'.repeat(500) })])

    const result = await mapPageMetadata({ id: encodePrettyId(FAMILY_ID) }, CONTEXT)

    expect(result?.description).toHaveLength(200)
    expect(result?.description.endsWith('…')).toBe(true)
  })

  test('returns undefined for a malformed id without querying', async () => {
    const result = await mapPageMetadata({ id: 'not-a-map' }, CONTEXT)

    expect(result).toBeUndefined()
    expect(resolveMapPageIdMock).not.toHaveBeenCalled()
    expect(getMapInfosMock).not.toHaveBeenCalled()
  })

  test('returns undefined for an id that names nothing', async () => {
    resolveMapPageIdMock.mockResolvedValueOnce(undefined)

    const result = await mapPageMetadata({ id: encodePrettyId(FAMILY_ID) }, CONTEXT)

    expect(result).toBeUndefined()
    expect(getMapInfosMock).not.toHaveBeenCalled()
  })

  test('returns undefined for a missing map', async () => {
    getMapInfosMock.mockResolvedValueOnce([])

    const result = await mapPageMetadata({ id: encodePrettyId(FAMILY_ID) }, CONTEXT)

    expect(result).toBeUndefined()
  })

  describe('compare page', () => {
    const OTHER_ID = makeSbMapId('5eed0000-0000-0000-0000-00000000cccc')

    test('names both maps, links the canonical ids and stays out of search engines', async () => {
      resolveMapIdMock.mockImplementation(async id => (id === ALIAS_ID ? MAP_ID : id))
      getMapInfosMock.mockResolvedValueOnce([
        makeMap({ id: OTHER_ID, name: 'Polypoid 1.76', jpegImageUrl: undefined }),
        makeMap(),
      ])

      const result = await mapComparePageMetadata(
        { a: encodePrettyId(ALIAS_ID), b: encodePrettyId(OTHER_ID) },
        CONTEXT,
      )

      expect(result).toEqual({
        url: `https://shieldbattery.net/maps/compare/${encodePrettyId(MAP_ID)}/${encodePrettyId(
          OTHER_ID,
        )}`,
        type: 'website',
        title: 'Polypoid 1.75 vs. Polypoid 1.76',
        description:
          'Compare the terrain, bases and start locations of Polypoid 1.75 and Polypoid 1.76.',
        image: 'https://cdn.example.com/maps/polypoid-1024.jpg',
        noindex: true,
      })
    })

    test('returns undefined when either map is missing', async () => {
      getMapInfosMock.mockResolvedValueOnce([makeMap()])

      const result = await mapComparePageMetadata(
        { a: encodePrettyId(MAP_ID), b: encodePrettyId(OTHER_ID) },
        CONTEXT,
      )

      expect(result).toBeUndefined()
    })
  })
})
