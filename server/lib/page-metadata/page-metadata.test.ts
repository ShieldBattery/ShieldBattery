import { beforeEach, describe, expect, test, vi } from 'vitest'
import { asMockedFunction } from '../../../common/testing/mocks'
import { newsPostPageMetadata } from '../news/news-page-meta'
import { PageMetadata, PageMetadataContext, resolvePageMetadata } from './page-metadata'

vi.mock('../news/news-page-meta', () => ({
  newsPostPageMetadata: vi.fn(),
}))

const newsPostPageMetadataMock = asMockedFunction(newsPostPageMetadata)

const CONTEXT: PageMetadataContext = {
  canonicalHost: 'https://shieldbattery.net',
  publicAssetsUrl: 'https://cdn.example.com/public/',
}

const DEFAULT_METADATA: PageMetadata = {
  url: 'https://shieldbattery.net',
  type: 'website',
  title: 'ShieldBattery',
  description: 'Play StarCraft 1 on the premier community-run platform.',
  image: 'https://shieldbattery.net/images/logo-and-text-1200x630.png',
}

describe('page-metadata/page-metadata', () => {
  beforeEach(() => {
    newsPostPageMetadataMock.mockReset()
  })

  test('matches a news post route and calls the resolver with the id param (no wildcard)', async () => {
    newsPostPageMetadataMock.mockResolvedValueOnce(undefined)

    await resolvePageMetadata('/news/abc123', CONTEXT)

    expect(newsPostPageMetadataMock).toHaveBeenCalledWith({ id: 'abc123', '*': undefined }, CONTEXT)
  })

  test('matches a news post route and passes the trailing wildcard segment', async () => {
    newsPostPageMetadataMock.mockResolvedValueOnce(undefined)

    await resolvePageMetadata('/news/abc123/some-post-slug', CONTEXT)

    expect(newsPostPageMetadataMock).toHaveBeenCalledWith(
      { id: 'abc123', '*': 'some-post-slug' },
      CONTEXT,
    )
  })

  test('returns the metadata a matching resolver produces', async () => {
    const metadata: PageMetadata = {
      url: 'https://shieldbattery.net/news/abc123',
      type: 'article',
      title: 'A post',
      description: 'A description',
      image: 'https://cdn.example.com/image.jpg',
      publishedTime: '2026-03-14T23:09:10.776Z',
    }
    newsPostPageMetadataMock.mockResolvedValueOnce(metadata)

    const result = await resolvePageMetadata('/news/abc123', CONTEXT)

    expect(result).toEqual(metadata)
  })

  test('falls back to the default metadata when the resolver returns undefined', async () => {
    newsPostPageMetadataMock.mockResolvedValueOnce(undefined)

    const result = await resolvePageMetadata('/news/abc123', CONTEXT)

    expect(result).toEqual(DEFAULT_METADATA)
  })

  test('falls back to the default metadata when the resolver throws, without propagating', async () => {
    newsPostPageMetadataMock.mockRejectedValueOnce(new Error('db went away'))

    await expect(resolvePageMetadata('/news/abc123', CONTEXT)).resolves.toEqual(DEFAULT_METADATA)
  })

  test('falls back to the default metadata for an unmatched path without calling any resolver', async () => {
    const result = await resolvePageMetadata('/ladder', CONTEXT)

    expect(newsPostPageMetadataMock).not.toHaveBeenCalled()
    expect(result).toEqual(DEFAULT_METADATA)
  })

  test('derives default field values from the given context', async () => {
    const otherContext: PageMetadataContext = {
      canonicalHost: 'https://staging.example.com',
      publicAssetsUrl: 'https://cdn.other.com/public/',
    }

    const result = await resolvePageMetadata('/some/unmatched/path', otherContext)

    expect(result).toEqual({
      url: 'https://staging.example.com',
      type: 'website',
      title: 'ShieldBattery',
      description: 'Play StarCraft 1 on the premier community-run platform.',
      image: 'https://staging.example.com/images/logo-and-text-1200x630.png',
    })
  })
})
