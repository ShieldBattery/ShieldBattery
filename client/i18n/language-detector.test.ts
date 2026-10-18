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

  test('Chinese with a Simplified region matches Simplified Chinese', () => {
    expect(getBestLanguage(['zh-CN', 'en-US'], SUPPORTED_LANGUAGES)).toBe(
      TranslationLanguage.ChineseSimplified,
    )
    expect(getBestLanguage(['zh-SG'], SUPPORTED_LANGUAGES)).toBe(
      TranslationLanguage.ChineseSimplified,
    )
    expect(getBestLanguage(['zh'], SUPPORTED_LANGUAGES)).toBe(TranslationLanguage.ChineseSimplified)
  })

  test('Chinese with a Traditional region does not match Simplified Chinese', () => {
    expect(getBestLanguage(['zh-TW', 'en-US'], SUPPORTED_LANGUAGES)).toBe(
      TranslationLanguage.English,
    )
    expect(getBestLanguage(['zh-HK', 'ko-KR'], SUPPORTED_LANGUAGES)).toBe(
      TranslationLanguage.Korean,
    )
  })

  test('matches tags regardless of case', () => {
    expect(getBestLanguage(['ZH-hans-cn'], SUPPORTED_LANGUAGES)).toBe(
      TranslationLanguage.ChineseSimplified,
    )
  })
})
