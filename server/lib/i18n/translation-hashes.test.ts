import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { ALL_TRANSLATION_LANGUAGES, TranslationLanguage } from '../../../common/i18n'
import { computeTranslationHashes } from './translation-hashes'

vi.mock('../logging/logger', () => ({
  default: { error: vi.fn() },
}))

describe('computeTranslationHashes', () => {
  let localesPath: string

  function writeTranslations(language: string, namespace: string, contents: string) {
    mkdirSync(path.join(localesPath, language), { recursive: true })
    writeFileSync(path.join(localesPath, language, `${namespace}.json`), contents)
  }

  beforeEach(() => {
    localesPath = mkdtempSync(path.join(tmpdir(), 'sb-translation-hashes-'))
    for (const language of ALL_TRANSLATION_LANGUAGES) {
      writeTranslations(language, 'global', `{"language":"${language}"}`)
    }
  })

  afterEach(() => {
    rmSync(localesPath, { recursive: true, force: true })
  })

  test('hashes every language', () => {
    const hashes = computeTranslationHashes(localesPath)

    expect(Object.keys(hashes).sort()).toEqual([...ALL_TRANSLATION_LANGUAGES].sort())
    expect(new Set(Object.values(hashes)).size).toBe(ALL_TRANSLATION_LANGUAGES.length)
  })

  test('changes only the hash of a language whose file changed', () => {
    const before = computeTranslationHashes(localesPath)
    writeTranslations(TranslationLanguage.Korean, 'global', '{"language":"ko","added":"key"}')
    const after = computeTranslationHashes(localesPath)

    expect(after[TranslationLanguage.Korean]).not.toBe(before[TranslationLanguage.Korean])
    expect({ ...after, [TranslationLanguage.Korean]: undefined }).toEqual({
      ...before,
      [TranslationLanguage.Korean]: undefined,
    })
  })

  test("ignores files the client doesn't load", () => {
    const before = computeTranslationHashes(localesPath)
    writeTranslations(TranslationLanguage.Korean, 'game', '{"some":"thing"}')

    expect(computeTranslationHashes(localesPath)).toEqual(before)
  })

  test('leaves out a language whose file is missing', () => {
    rmSync(path.join(localesPath, TranslationLanguage.Spanish), { recursive: true })

    const hashes = computeTranslationHashes(localesPath)

    expect(hashes[TranslationLanguage.Spanish]).toBeUndefined()
    expect(Object.keys(hashes)).toHaveLength(ALL_TRANSLATION_LANGUAGES.length - 1)
  })

  test('hashes the translation files in the repo', () => {
    const hashes = computeTranslationHashes()

    expect(Object.keys(hashes).sort()).toEqual([...ALL_TRANSLATION_LANGUAGES].sort())
  })
})
