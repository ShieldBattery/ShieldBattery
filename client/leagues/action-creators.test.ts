import { beforeEach, describe, expect, test, vi } from 'vitest'
import { TranslationLanguage } from '../../common/i18n'
import { makeLeagueId } from '../../common/leagues/leagues'
import { MatchmakingType } from '../../common/matchmaking'
import { fetchJson } from '../network/fetch'
import { RootState } from '../root-reducer'
import { adminAddLeague, adminUpdateLeague } from './action-creators'

vi.mock('../network/fetch', () => ({ fetchJson: vi.fn() }))
vi.mock('../navigation/routing', () => ({ push: vi.fn(), replace: vi.fn() }))

const translations = [
  { language: TranslationLanguage.Spanish, name: '', description: 'Descripción', rulesAndInfo: '' },
]

describe('league translation request serialization', () => {
  beforeEach(() => vi.mocked(fetchJson).mockReset())

  test('preserves empty translated fields when creating a league', async () => {
    await new Promise<void>((resolve, reject) => {
      adminAddLeague({
        leagueData: {
          name: 'League',
          description: 'Description',
          matchmakingType: MatchmakingType.Match1v1,
          signupsAfter: 1,
          startAt: 2,
          endAt: 3,
          translations,
          rulesAndInfo: '',
          link: '',
        },
        spec: { onSuccess: resolve, onError: reject },
      })(vi.fn(), () => ({}) as RootState)
    })
    const body = vi.mocked(fetchJson).mock.calls[0][1]!.body as FormData
    const data = JSON.parse(body.get('leagueData') as string)
    expect(data.translations).toEqual(translations)
    expect(data).not.toHaveProperty('rulesAndInfo')
    expect(data).not.toHaveProperty('link')
  })

  test('clears default optional fields without converting empty translations to null', async () => {
    await new Promise<void>((resolve, reject) => {
      adminUpdateLeague({
        id: makeLeagueId('league'),
        leagueChanges: { translations, rulesAndInfo: '', link: '' },
        spec: { onSuccess: resolve, onError: reject },
      })(vi.fn(), () => ({}) as RootState)
    })
    const body = vi.mocked(fetchJson).mock.calls[0][1]!.body as FormData
    expect(JSON.parse(body.get('leagueChanges') as string)).toEqual({
      translations,
      rulesAndInfo: null,
      link: null,
    })
  })
})
