import { act, renderHook } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import {
  currentFormatLocale,
  dateTimeFormat,
  getFormatLocale,
  relativeTimeFormat,
  useFormat,
  useFormatLocale,
} from './locale-formats'

const fakeI18n = vi.hoisted(() => {
  const listeners = new Set<(lng: string) => void>()
  return {
    language: 'en',
    resolvedLanguage: 'en',
    on(_event: string, listener: (lng: string) => void) {
      listeners.add(listener)
    },
    off(_event: string, listener: (lng: string) => void) {
      listeners.delete(listener)
    },
    changeLanguage(lng: string) {
      this.language = lng
      this.resolvedLanguage = lng
      for (const listener of listeners) {
        listener(lng)
      }
    },
  }
})

vi.mock('./i18next', () => ({ default: fakeI18n }))

describe('getFormatLocale', () => {
  test('combines the app language with the system region', () => {
    expect(getFormatLocale('es', 'en-US')).toBe('es-US')
    expect(getFormatLocale('en', 'en-GB')).toBe('en-GB')
    expect(getFormatLocale('zh-Hans', 'en-US')).toBe('zh-Hans-US')
  })

  test('uses the app language alone when the system locale has no region', () => {
    expect(getFormatLocale('ru', 'en')).toBe('ru')
    expect(getFormatLocale('ko', '')).toBe('ko')
  })

  test('ignores a system locale it cannot parse', () => {
    expect(getFormatLocale('es', 'not a locale')).toBe('es')
  })

  test('formats words in the app language', () => {
    const format = new Intl.DateTimeFormat(getFormatLocale('es', 'ru-RU'), { month: 'long' })
    expect(format.format(new Date(2026, 8, 25))).toBe('septiembre')
  })
})

describe('LocaleFormat', () => {
  test('reuses the formatter for a locale', () => {
    const format = dateTimeFormat({ month: 'long' })
    expect(format.forLocale('es')).toBe(format.forLocale('es'))
    expect(format.forLocale('ko')).not.toBe(format.forLocale('es'))
    expect(format.forLocale('ko').resolvedOptions().locale).toBe('ko')
  })

  test('current() follows the app language', () => {
    const format = relativeTimeFormat({ numeric: 'always' })
    act(() => fakeI18n.changeLanguage('es'))
    expect(currentFormatLocale()).toBe(getFormatLocale('es'))
    expect(format.current()).toBe(format.forLocale(getFormatLocale('es')))

    act(() => fakeI18n.changeLanguage('ru'))
    expect(format.current()).toBe(format.forLocale(getFormatLocale('ru')))
  })
})

describe('useFormat', () => {
  test('returns the formatter for the new language after a language change', () => {
    const format = dateTimeFormat({ month: 'long' })
    act(() => fakeI18n.changeLanguage('es'))
    const { result: locale } = renderHook(() => useFormatLocale())
    const { result } = renderHook(() => useFormat(format))
    const date = new Date(2026, 8, 25)

    expect(locale.current).toBe(getFormatLocale('es'))
    expect(result.current.format(date)).toBe('septiembre')

    act(() => fakeI18n.changeLanguage('ru'))

    expect(locale.current).toBe(getFormatLocale('ru'))
    expect(result.current.format(date)).toBe('сентябрь')
  })
})
