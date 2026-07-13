import { beforeEach, describe, expect, test, vi } from 'vitest'
import { asMockedFunction } from '../../../common/testing/mocks'
import { getUrl } from '../files'
import { getNewsPageMeta, matchNewsPostRoute } from './news-page-meta'
import { getPublishedNewsPostMeta, PublishedNewsPostMeta } from './news-post-models'

vi.mock('./news-post-models', () => ({
  getPublishedNewsPostMeta: vi.fn(),
}))

vi.mock('../files', () => ({
  getUrl: vi.fn((path: string) => `https://cdn.example.com/${path}`),
}))

const getPublishedNewsPostMetaMock = asMockedFunction(getPublishedNewsPostMeta)
const getUrlMock = asMockedFunction(getUrl)

const PUBLIC_ASSETS_URL = 'https://cdn.example.com/public/'
// Hashes to the 'ashworld0' stock image (index 0), verified against the shared implementation in
// common/news.ts.
const UUID = '5eed0000-0000-0000-0000-000000000023'

describe('news/news-page-meta', () => {
  describe('matchNewsPostRoute', () => {
    test('matches a bare uuid path', () => {
      expect(matchNewsPostRoute(`/news/${UUID}`)).toBe(UUID)
    })

    test('matches with a single trailing slash', () => {
      expect(matchNewsPostRoute(`/news/${UUID}/`)).toBe(UUID)
    })

    test('is case-insensitive', () => {
      const upper = UUID.toUpperCase()
      expect(matchNewsPostRoute(`/news/${upper}`)).toBe(upper)
    })

    test('rejects the bare /news route', () => {
      expect(matchNewsPostRoute('/news')).toBeUndefined()
      expect(matchNewsPostRoute('/news/')).toBeUndefined()
    })

    test('rejects extra path segments after the id', () => {
      expect(matchNewsPostRoute(`/news/${UUID}/extra`)).toBeUndefined()
      expect(matchNewsPostRoute('/news/foo/bar')).toBeUndefined()
    })

    test('rejects a non-uuid id', () => {
      expect(matchNewsPostRoute('/news/not-a-uuid')).toBeUndefined()
      expect(matchNewsPostRoute('/news/12345')).toBeUndefined()
      // Too few hex digits in the last group.
      expect(matchNewsPostRoute('/news/5eed0000-0000-0000-0000-00000000')).toBeUndefined()
    })

    test('rejects unrelated routes', () => {
      expect(matchNewsPostRoute('/')).toBeUndefined()
      expect(matchNewsPostRoute('/newsletter')).toBeUndefined()
      expect(matchNewsPostRoute(`/admin/news/${UUID}`)).toBeUndefined()
      expect(matchNewsPostRoute(`/news/${UUID}?query=1`)).toBeUndefined()
    })
  })

  describe('getNewsPageMeta', () => {
    const BASE_POST: PublishedNewsPostMeta = {
      title: 'Update 10.4.0',
      summary: '  Automatic replay uploads, replay viewing from game results, and more!  ',
      coverImagePath: null,
      publishedAt: new Date('2026-03-14T23:09:10.776Z'),
    }

    beforeEach(() => {
      getPublishedNewsPostMetaMock.mockReset()
      getUrlMock.mockClear()
      process.env.SB_CANONICAL_HOST = 'https://shieldbattery.net'
    })

    test('returns undefined for a non-news route without querying the model', async () => {
      const result = await getNewsPageMeta('/ladder', PUBLIC_ASSETS_URL)

      expect(result).toBeUndefined()
      expect(getPublishedNewsPostMetaMock).not.toHaveBeenCalled()
    })

    test('returns undefined when the post is not found/unpublished', async () => {
      getPublishedNewsPostMetaMock.mockResolvedValueOnce(undefined)

      const result = await getNewsPageMeta(`/news/${UUID}`, PUBLIC_ASSETS_URL)

      expect(result).toBeUndefined()
    })

    test('returns undefined when the model throws', async () => {
      getPublishedNewsPostMetaMock.mockRejectedValueOnce(new Error('db went away'))

      const result = await getNewsPageMeta(`/news/${UUID}`, PUBLIC_ASSETS_URL)

      expect(result).toBeUndefined()
    })

    test('uses the uploaded cover image and trims the summary when a cover is present', async () => {
      getPublishedNewsPostMetaMock.mockResolvedValueOnce({
        ...BASE_POST,
        coverImagePath: 'news-images/ab/cd/xyz.jpg',
      })

      const result = await getNewsPageMeta(`/news/${UUID}`, PUBLIC_ASSETS_URL)

      expect(result).toEqual({
        url: `https://shieldbattery.net/news/${UUID}`,
        title: 'Update 10.4.0',
        description: 'Automatic replay uploads, replay viewing from game results, and more!',
        image: 'https://cdn.example.com/news-images/ab/cd/xyz.jpg',
        publishedTime: '2026-03-14T23:09:10.776Z',
      })
      expect(getUrlMock).toHaveBeenCalledWith('news-images/ab/cd/xyz.jpg')
    })

    test('falls back to a deterministic stock image when there is no cover', async () => {
      getPublishedNewsPostMetaMock.mockResolvedValueOnce({ ...BASE_POST, coverImagePath: null })

      const result = await getNewsPageMeta(`/news/${UUID}`, PUBLIC_ASSETS_URL)

      expect(result?.image).toBe(`${PUBLIC_ASSETS_URL}images/static-news/ashworld0.jpg`)

      // Deterministic: the same id always maps to the same stock image.
      getPublishedNewsPostMetaMock.mockResolvedValueOnce({ ...BASE_POST, coverImagePath: null })
      const again = await getNewsPageMeta(`/news/${UUID}`, PUBLIC_ASSETS_URL)

      expect(again?.image).toBe(result?.image)
    })

    test('strips a trailing slash from SB_CANONICAL_HOST', async () => {
      process.env.SB_CANONICAL_HOST = 'https://shieldbattery.net/'
      getPublishedNewsPostMetaMock.mockResolvedValueOnce({ ...BASE_POST })

      const result = await getNewsPageMeta(`/news/${UUID}`, PUBLIC_ASSETS_URL)

      expect(result?.url).toBe(`https://shieldbattery.net/news/${UUID}`)
    })
  })
})
