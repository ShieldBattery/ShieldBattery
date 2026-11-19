import { describe, expect, test } from 'vitest'
import { TranslationLanguage, TranslationNamespace } from '../../common/i18n'
import { setServerConfig } from '../server-config-storage'
import { makeTranslationUrl } from './i18next'

const APP_VERSION = import.meta.env.SB_VERSION

const BASE_CONFIG = {
  publicAssetsUrl: 'https://cdn.example.org/public/',
  graphqlOrigin: 'https://gql.example.org/',
}

describe('makeTranslationUrl', () => {
  test("keys the URL on the server's hash of the file", () => {
    setServerConfig({
      ...BASE_CONFIG,
      translationHashes: {
        [TranslationLanguage.English]: 'englishhash',
        [TranslationLanguage.ChineseSimplified]: 'chinesehash',
      },
    })

    expect(makeTranslationUrl('en', TranslationNamespace.Global)).toBe(
      'https://cdn.example.org/public/locales/en/global.json?englishhash',
    )
    expect(makeTranslationUrl('zh-Hans', TranslationNamespace.Global)).toBe(
      'https://cdn.example.org/public/locales/zh-Hans/global.json?chinesehash',
    )
  })

  test('falls back to the app version for a language without a hash', () => {
    setServerConfig({
      ...BASE_CONFIG,
      translationHashes: { [TranslationLanguage.English]: 'englishhash' },
    })

    expect(makeTranslationUrl('ko', TranslationNamespace.Global)).toBe(
      `https://cdn.example.org/public/locales/ko/global.json?${APP_VERSION}`,
    )
  })

  test('falls back to the app version when the config has no hashes', () => {
    setServerConfig(BASE_CONFIG)

    expect(makeTranslationUrl('en', TranslationNamespace.Global)).toBe(
      `https://cdn.example.org/public/locales/en/global.json?${APP_VERSION}`,
    )
  })

  test("doesn't apply the hashes to other namespaces", () => {
    setServerConfig({
      ...BASE_CONFIG,
      translationHashes: { [TranslationLanguage.English]: 'englishhash' },
    })

    expect(makeTranslationUrl('en', TranslationNamespace.Game)).toBe(
      `https://cdn.example.org/public/locales/en/game.json?${APP_VERSION}`,
    )
  })
})
