import { beforeEach, describe, expect, test, vi } from 'vitest'
import { makeSbMapId, MapInfo, MapVisibility, Tileset } from '../../../common/maps'
import { encodePrettyId } from '../../../common/pretty-id'
import { asMockedFunction } from '../../../common/testing/mocks'
import { PageMetadataContext } from '../page-metadata/types'
import { getMapInfos, resolveMapId } from './map-models'
import { mapPageMetadata } from './map-page-meta'

vi.mock('./map-models', () => ({
  getMapInfos: vi.fn(),
  resolveMapId: vi.fn(),
}))

const getMapInfosMock = asMockedFunction(getMapInfos)
const resolveMapIdMock = asMockedFunction(resolveMapId)

const CONTEXT: PageMetadataContext = {
  canonicalHost: 'https://shieldbattery.net',
  publicAssetsUrl: 'https://cdn.example.com/public/',
}

const MAP_ID = makeSbMapId('5eed0000-0000-0000-0000-00000000aaaa')
const ALIAS_ID = makeSbMapId('5eed0000-0000-0000-0000-00000000bbbb')

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

describe('maps/map-page-meta', () => {
  beforeEach(() => {
    getMapInfosMock.mockReset()
    resolveMapIdMock.mockReset()
    resolveMapIdMock.mockImplementation(async id => id)
  })

  test('builds metadata for a listed map', async () => {
    getMapInfosMock.mockResolvedValueOnce([makeMap()])

    const result = await mapPageMetadata({ id: encodePrettyId(MAP_ID) }, CONTEXT)

    expect(result).toEqual({
      url: `https://shieldbattery.net/maps/${encodePrettyId(MAP_ID)}/polypoid-1-75`,
      type: 'website',
      title: 'Polypoid 1.75',
      description: 'The modern four-player standard.',
      image: 'https://cdn.example.com/maps/polypoid-1024.jpg',
      noindex: false,
    })
  })

  test('accepts a raw UUID and points the canonical URL at the current id of an alias', async () => {
    resolveMapIdMock.mockResolvedValueOnce(MAP_ID)
    getMapInfosMock.mockResolvedValueOnce([makeMap()])

    const result = await mapPageMetadata({ id: ALIAS_ID }, CONTEXT)

    expect(resolveMapIdMock).toHaveBeenCalledWith(ALIAS_ID)
    expect(getMapInfosMock).toHaveBeenCalledWith([MAP_ID])
    expect(result?.url).toBe(
      `https://shieldbattery.net/maps/${encodePrettyId(MAP_ID)}/polypoid-1-75`,
    )
  })

  test('keeps unlisted maps out of search engines', async () => {
    getMapInfosMock.mockResolvedValueOnce([makeMap({ visibility: MapVisibility.Unlisted })])

    const result = await mapPageMetadata({ id: encodePrettyId(MAP_ID) }, CONTEXT)

    expect(result?.noindex).toBe(true)
  })

  test('strips color codes and describes maps without a description', async () => {
    getMapInfosMock.mockResolvedValueOnce([
      makeMap({ name: '\x03Lost \x04Temple', description: '  \x05 ' }),
    ])

    const result = await mapPageMetadata({ id: encodePrettyId(MAP_ID) }, CONTEXT)

    expect(result?.title).toBe('Lost Temple')
    expect(result?.description).toBe('A 4-player Jungle world melee map. Play it on ShieldBattery.')
  })

  test('truncates long descriptions', async () => {
    getMapInfosMock.mockResolvedValueOnce([makeMap({ description: 'a'.repeat(500) })])

    const result = await mapPageMetadata({ id: encodePrettyId(MAP_ID) }, CONTEXT)

    expect(result?.description).toHaveLength(200)
    expect(result?.description.endsWith('…')).toBe(true)
  })

  test('returns undefined for a malformed id without querying', async () => {
    const result = await mapPageMetadata({ id: 'not-a-map' }, CONTEXT)

    expect(result).toBeUndefined()
    expect(resolveMapIdMock).not.toHaveBeenCalled()
    expect(getMapInfosMock).not.toHaveBeenCalled()
  })

  test('returns undefined for a missing map', async () => {
    getMapInfosMock.mockResolvedValueOnce([])

    const result = await mapPageMetadata({ id: encodePrettyId(MAP_ID) }, CONTEXT)

    expect(result).toBeUndefined()
  })
})
