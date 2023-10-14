import { TranslationLanguage } from '../../common/i18n'
import { getBestLanguage } from './language-detector'

describe('client/i18n/language-detector', () => {
  test('returns the english language if none of the given languages are supported', () => {
    const lng = getBestLanguage(['INVALID_LANGUAGE'])

    expect(lng).toBe(TranslationLanguage.English)
  })

  test('returns the earliest matching language without dialect', () => {
    const lng = getBestLanguage(['en-US', 'kr'])

    expect(lng).toBe(TranslationLanguage.English)
  })

  test('returns the exact match for the language with dialect', () => {
    const lng = getBestLanguage(['zh-Hans', 'en-US'])

    expect(lng).toBe(TranslationLanguage.ChineseSimplified)
  })
})
