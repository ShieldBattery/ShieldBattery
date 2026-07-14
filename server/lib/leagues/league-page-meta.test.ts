import { beforeEach, describe, expect, test, vi } from 'vitest'
import { League, makeLeagueId } from '../../../common/leagues/leagues'
import { MatchmakingType } from '../../../common/matchmaking'
import { encodePrettyId } from '../../../common/pretty-id'
import { asMockedFunction } from '../../../common/testing/mocks'
import { PageMetadataContext } from '../page-metadata/page-metadata'
import { getLeague } from './league-models'
import { leaguePageMetadata } from './league-page-meta'

vi.mock('./league-models', () => ({
  getLeague: vi.fn(),
}))

const getLeagueMock = asMockedFunction(getLeague)

const CONTEXT: PageMetadataContext = {
  canonicalHost: 'https://shieldbattery.net',
  publicAssetsUrl: 'https://cdn.example.com/public/',
}

const UUID = '5eed0000-0000-0000-0000-000000000099'
const PRETTY_ID = encodePrettyId(UUID)

describe('leagues/league-page-meta', () => {
  describe('leaguePageMetadata', () => {
    const BASE_LEAGUE: League = {
      id: makeLeagueId(UUID),
      name: 'Spring Championship',
      matchmakingType: MatchmakingType.Match1v1,
      description: 'A league for the best players.',
      signupsAfter: new Date('2026-01-01T00:00:00.000Z'),
      startAt: new Date('2026-02-01T00:00:00.000Z'),
      endAt: new Date('2026-03-01T00:00:00.000Z'),
    }

    beforeEach(() => {
      getLeagueMock.mockReset()
    })

    test('returns undefined for a raw (unencoded) uuid without querying the model', async () => {
      const result = await leaguePageMetadata({ id: UUID }, CONTEXT)

      expect(result).toBeUndefined()
      expect(getLeagueMock).not.toHaveBeenCalled()
    })

    test('returns undefined for a malformed id without querying the model', async () => {
      expect(await leaguePageMetadata({ id: 'admin' }, CONTEXT)).toBeUndefined()
      expect(await leaguePageMetadata({ id: PRETTY_ID.slice(0, -1) }, CONTEXT)).toBeUndefined()
      expect(await leaguePageMetadata({ id: `${PRETTY_ID}X` }, CONTEXT)).toBeUndefined()

      expect(getLeagueMock).not.toHaveBeenCalled()
    })

    test('returns undefined when the id param is missing without querying the model', async () => {
      const result = await leaguePageMetadata({ id: undefined }, CONTEXT)

      expect(result).toBeUndefined()
      expect(getLeagueMock).not.toHaveBeenCalled()
    })

    test('returns undefined when the league is not found or not yet visible', async () => {
      getLeagueMock.mockResolvedValueOnce(undefined)

      const result = await leaguePageMetadata({ id: PRETTY_ID }, CONTEXT)

      expect(result).toBeUndefined()
    })

    test('uses the imagePath verbatim when present', async () => {
      getLeagueMock.mockResolvedValueOnce({
        ...BASE_LEAGUE,
        imagePath: 'https://cdn.example.com/leagues/abc/image.jpg',
      })

      const result = await leaguePageMetadata({ id: PRETTY_ID }, CONTEXT)

      expect(result).toEqual({
        url: `https://shieldbattery.net/leagues/${PRETTY_ID}/spring-championship`,
        type: 'website',
        title: 'Spring Championship',
        description: 'A league for the best players.',
        image: 'https://cdn.example.com/leagues/abc/image.jpg',
      })
    })

    test('falls back to the default page image when there is no imagePath', async () => {
      getLeagueMock.mockResolvedValueOnce({ ...BASE_LEAGUE, imagePath: undefined })

      const result = await leaguePageMetadata({ id: PRETTY_ID }, CONTEXT)

      expect(result?.image).toBe('https://shieldbattery.net/images/logo-and-text-1200x630.png')
    })

    test('collapses a multi-line description to a single line', async () => {
      getLeagueMock.mockResolvedValueOnce({
        ...BASE_LEAGUE,
        description: '  Line one\n  Line two  \n\n  Line three  ',
      })

      const result = await leaguePageMetadata({ id: PRETTY_ID }, CONTEXT)

      expect(result?.description).toBe('Line one Line two Line three')
    })
  })
})
