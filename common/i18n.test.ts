import { describe, expect, test } from 'vitest'
import { getBestLanguage, resolveTranslationLanguage, TranslationLanguage } from './i18n'

const SUPPORTED_LANGUAGES = ['zh-Hans', 'en', 'ko', 'ru', 'es']

describe('common/i18n getBestLanguage', () => {
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

  test('a bare Chinese entry keeps the script of an earlier regional one', () => {
    // How Chrome reports a Taiwanese user's languages: the bare form follows the regional one
    expect(getBestLanguage(['zh-TW', 'zh', 'en-US', 'en'], SUPPORTED_LANGUAGES)).toBe(
      TranslationLanguage.English,
    )
    expect(getBestLanguage(['zh-HK', 'zh', 'ko'], SUPPORTED_LANGUAGES)).toBe(
      TranslationLanguage.Korean,
    )
    expect(getBestLanguage(['zh-CN', 'zh', 'en'], SUPPORTED_LANGUAGES)).toBe(
      TranslationLanguage.ChineseSimplified,
    )
  })

  test('a bare Chinese entry listed first means Simplified Chinese', () => {
    expect(getBestLanguage(['zh', 'zh-TW'], SUPPORTED_LANGUAGES)).toBe(
      TranslationLanguage.ChineseSimplified,
    )
  })

  test('matches tags regardless of case', () => {
    expect(getBestLanguage(['ZH-hans-cn'], SUPPORTED_LANGUAGES)).toBe(
      TranslationLanguage.ChineseSimplified,
    )
  })
})

describe('common/i18n resolveTranslationLanguage', () => {
  // server-rs/src/email.rs tests `resolve_translation_language` against these same cases
  test.each<[string | null | undefined, TranslationLanguage]>([
    [undefined, TranslationLanguage.English],
    [null, TranslationLanguage.English],
    ['', TranslationLanguage.English],
    ['en', TranslationLanguage.English],
    ['en-US', TranslationLanguage.English],
    ['ko', TranslationLanguage.Korean],
    ['ko-KR', TranslationLanguage.Korean],
    ['es', TranslationLanguage.Spanish],
    ['es-MX', TranslationLanguage.Spanish],
    ['es-419', TranslationLanguage.Spanish],
    ['ru-RU', TranslationLanguage.Russian],
    ['zh-Hans', TranslationLanguage.ChineseSimplified],
    ['zh-CN', TranslationLanguage.ChineseSimplified],
    ['zh-SG', TranslationLanguage.ChineseSimplified],
    ['zh', TranslationLanguage.ChineseSimplified],
    ['zh-Hans-CN', TranslationLanguage.ChineseSimplified],
    ['ZH-hans-cn', TranslationLanguage.ChineseSimplified],
    ['zh-TW', TranslationLanguage.English],
    ['zh-HK', TranslationLanguage.English],
    ['zh-US', TranslationLanguage.English],
    ['zh-Hant', TranslationLanguage.English],
    ['zh-Hant-CN', TranslationLanguage.English],
    ['pt-BR', TranslationLanguage.English],
    ['ko_KR', TranslationLanguage.English],
    ['zh-cmn-Hans', TranslationLanguage.English],
    ['not a locale', TranslationLanguage.English],
  ])('%j resolves to %s', (locale, expected) => {
    expect(resolveTranslationLanguage(locale)).toBe(expected)
  })
})
