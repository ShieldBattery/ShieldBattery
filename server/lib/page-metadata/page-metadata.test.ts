import { beforeEach, describe, expect, test, vi } from 'vitest'
import { asMockedFunction } from '../../../common/testing/mocks'
import { gamePageMetadata } from '../games/game-page-meta'
import { leaguePageMetadata } from '../leagues/league-page-meta'
import { newsPostPageMetadata } from '../news/news-page-meta'
import { userPageMetadata } from '../users/user-page-meta'
import { PageMetadata, PageMetadataContext, resolvePageMetadata } from './page-metadata'

vi.mock('../news/news-page-meta', () => ({
  newsPostPageMetadata: vi.fn(),
}))

vi.mock('../leagues/league-page-meta', () => ({
  leaguePageMetadata: vi.fn(),
}))

vi.mock('../users/user-page-meta', () => ({
  userPageMetadata: vi.fn(),
}))

vi.mock('../games/game-page-meta', () => ({
  gamePageMetadata: vi.fn(),
}))

const newsPostPageMetadataMock = asMockedFunction(newsPostPageMetadata)
const leaguePageMetadataMock = asMockedFunction(leaguePageMetadata)
const userPageMetadataMock = asMockedFunction(userPageMetadata)
const gamePageMetadataMock = asMockedFunction(gamePageMetadata)

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
    leaguePageMetadataMock.mockReset()
    userPageMetadataMock.mockReset()
    gamePageMetadataMock.mockReset()
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
    const result = await resolvePageMetadata('/some/unmatched/path', CONTEXT)

    expect(newsPostPageMetadataMock).not.toHaveBeenCalled()
    expect(leaguePageMetadataMock).not.toHaveBeenCalled()
    expect(userPageMetadataMock).not.toHaveBeenCalled()
    expect(gamePageMetadataMock).not.toHaveBeenCalled()
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

  test('matches the league route and calls the resolver with the id param', async () => {
    leaguePageMetadataMock.mockResolvedValueOnce(undefined)

    await resolvePageMetadata('/leagues/abc123/some-league-slug', CONTEXT)

    expect(leaguePageMetadataMock).toHaveBeenCalledWith(
      { id: 'abc123', '*': 'some-league-slug' },
      CONTEXT,
    )
  })

  test('matches the user route and calls the resolver with the id param', async () => {
    userPageMetadataMock.mockResolvedValueOnce(undefined)

    await resolvePageMetadata('/users/123/some-username', CONTEXT)

    expect(userPageMetadataMock).toHaveBeenCalledWith({ id: '123', '*': 'some-username' }, CONTEXT)
  })

  test('matches the game route and calls the resolver with the id param', async () => {
    gamePageMetadataMock.mockResolvedValueOnce(undefined)

    await resolvePageMetadata('/games/abc123', CONTEXT)

    expect(gamePageMetadataMock).toHaveBeenCalledWith({ id: 'abc123', '*': undefined }, CONTEXT)
  })

  test('resolves a static route to its fixed title/description/canonical url', async () => {
    const result = await resolvePageMetadata('/download', CONTEXT)

    expect(result).toEqual({
      url: 'https://shieldbattery.net/download',
      type: 'website',
      title: 'Download ShieldBattery',
      description:
        'Download ShieldBattery to play StarCraft: Brood War online with modern matchmaking, ' +
        'ladder rankings, leagues, and more.',
      image: 'https://shieldbattery.net/images/logo-and-text-1200x630.png',
    })
  })

  test('matches a static route registered with a trailing wildcard', async () => {
    const result = await resolvePageMetadata('/ladder/1v1', CONTEXT)

    expect(result).toEqual({
      url: 'https://shieldbattery.net/ladder',
      type: 'website',
      title: 'ShieldBattery Ladder',
      description:
        'See the best StarCraft: Brood War players on the ShieldBattery ladder rankings.',
      image: 'https://shieldbattery.net/images/logo-and-text-1200x630.png',
    })
  })
})
