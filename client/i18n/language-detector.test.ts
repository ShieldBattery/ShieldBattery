import { describe, expect, test } from 'vitest'
import { TranslationLanguage } from '../../common/i18n'
import { getBestLanguage } from './language-detector'

const SUPPORTED_LANGUAGES = ['zh-Hans', 'en', 'ko', 'ru', 'es']

describe('client/i18n/language-detector', () => {
  test('returns the english language if none of the given languages are supported', () => {
    const lng = getBestLanguage(['INVALID_LANGUAGE'], SUPPORTED_LANGUAGES)

    expect(lng).toBe(TranslationLanguage.English)
  })

  test('returns the earliest matching language without dialect', () => {
    const lng = getBestLanguage(['en-US', 'ko-KR'], SUPPORTED_LANGUAGES)

    expect(lng).toBe(TranslationLanguage.English)
  })

  test('returns the exact match for the language with dialect', () => {
    const lng = getBestLanguage(['zh-Hans', 'en-US'], SUPPORTED_LANGUAGES)

    expect(lng).toBe(TranslationLanguage.ChineseSimplified)
  })

  test('language with a dialect will match a non-dialect code', () => {
    const lng = getBestLanguage(['es-MX', 'en-US'], SUPPORTED_LANGUAGES)

    expect(lng).toBe(TranslationLanguage.Spanish)
  })
})
