import { beforeEach, describe, expect, test, vi } from 'vitest'
import { encodePrettyId } from '../../../common/pretty-id'
import { asMockedFunction } from '../../../common/testing/mocks'
import { getUrl } from '../files'
import { PageMetadataContext } from '../page-metadata/page-metadata'
import { newsPostPageMetadata } from './news-page-meta'
import { getPublishedNewsPostMeta, PublishedNewsPostMeta } from './news-post-models'

vi.mock('./news-post-models', () => ({
  getPublishedNewsPostMeta: vi.fn(),
}))

vi.mock('../files', () => ({
  getUrl: vi.fn((path: string) => `https://cdn.example.com/${path}`),
}))

const getPublishedNewsPostMetaMock = asMockedFunction(getPublishedNewsPostMeta)
const getUrlMock = asMockedFunction(getUrl)

const CONTEXT: PageMetadataContext = {
  canonicalHost: 'https://shieldbattery.net',
  publicAssetsUrl: 'https://cdn.example.com/public/',
}

// Hashes to the 'ashworld0' stock image (index 0), verified against the shared implementation in
// common/news.ts.
const UUID = '5eed0000-0000-0000-0000-000000000023'
const PRETTY_ID = encodePrettyId(UUID)

describe('news/news-page-meta', () => {
  describe('newsPostPageMetadata', () => {
    const BASE_POST: PublishedNewsPostMeta = {
      title: 'Update 10.4.0',
      summary: '  Automatic replay uploads, replay viewing from game results, and more!  ',
      coverImagePath: null,
      publishedAt: new Date('2026-03-14T23:09:10.776Z'),
    }

    beforeEach(() => {
      getPublishedNewsPostMetaMock.mockReset()
      getUrlMock.mockClear()
    })

    test('returns undefined for a raw (unencoded) uuid without querying the model', async () => {
      const result = await newsPostPageMetadata({ id: UUID }, CONTEXT)

      expect(result).toBeUndefined()
      expect(getPublishedNewsPostMetaMock).not.toHaveBeenCalled()
    })

    test('returns undefined for a malformed id without querying the model', async () => {
      expect(await newsPostPageMetadata({ id: 'not-a-pretty-id-at-all!' }, CONTEXT)).toBeUndefined()
      expect(await newsPostPageMetadata({ id: PRETTY_ID.slice(0, -1) }, CONTEXT)).toBeUndefined()
      expect(await newsPostPageMetadata({ id: `${PRETTY_ID}X` }, CONTEXT)).toBeUndefined()

      expect(getPublishedNewsPostMetaMock).not.toHaveBeenCalled()
    })

    test('returns undefined when the id param is missing without querying the model', async () => {
      const result = await newsPostPageMetadata({ id: undefined }, CONTEXT)

      expect(result).toBeUndefined()
      expect(getPublishedNewsPostMetaMock).not.toHaveBeenCalled()
    })

    test('decodes the pretty id back to the raw uuid before querying the model', async () => {
      getPublishedNewsPostMetaMock.mockResolvedValueOnce({ ...BASE_POST })

      await newsPostPageMetadata({ id: PRETTY_ID }, CONTEXT)

      expect(getPublishedNewsPostMetaMock).toHaveBeenCalledWith(UUID)
    })

    test('returns undefined when the post is not found/unpublished', async () => {
      getPublishedNewsPostMetaMock.mockResolvedValueOnce(undefined)

      const result = await newsPostPageMetadata({ id: PRETTY_ID }, CONTEXT)

      expect(result).toBeUndefined()
    })

    test('uses the uploaded cover image and trims the summary when a cover is present', async () => {
      getPublishedNewsPostMetaMock.mockResolvedValueOnce({
        ...BASE_POST,
        coverImagePath: 'news-images/ab/cd/xyz.jpg',
      })

      const result = await newsPostPageMetadata({ id: PRETTY_ID }, CONTEXT)

      expect(result).toEqual({
        url: `https://shieldbattery.net/news/${PRETTY_ID}/update-1040`,
        type: 'article',
        title: 'Update 10.4.0',
        description: 'Automatic replay uploads, replay viewing from game results, and more!',
        image: 'https://cdn.example.com/news-images/ab/cd/xyz.jpg',
        publishedTime: '2026-03-14T23:09:10.776Z',
      })
      expect(getUrlMock).toHaveBeenCalledWith('news-images/ab/cd/xyz.jpg')
    })

    test('falls back to a deterministic stock image when there is no cover', async () => {
      getPublishedNewsPostMetaMock.mockResolvedValueOnce({ ...BASE_POST, coverImagePath: null })

      const result = await newsPostPageMetadata({ id: PRETTY_ID }, CONTEXT)

      expect(result?.image).toBe(`${CONTEXT.publicAssetsUrl}images/static-news/ashworld0.jpg`)

      // Deterministic: the same id always maps to the same stock image.
      getPublishedNewsPostMetaMock.mockResolvedValueOnce({ ...BASE_POST, coverImagePath: null })
      const again = await newsPostPageMetadata({ id: PRETTY_ID }, CONTEXT)

      expect(again?.image).toBe(result?.image)
    })

    test('builds a canonical, slugged url from the context canonical host', async () => {
      getPublishedNewsPostMetaMock.mockResolvedValueOnce({ ...BASE_POST })

      const result = await newsPostPageMetadata(
        { id: PRETTY_ID },
        { ...CONTEXT, canonicalHost: 'https://staging.example.com' },
      )

      expect(result?.url).toBe(`https://staging.example.com/news/${PRETTY_ID}/update-1040`)
    })
  })
})
