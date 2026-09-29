import { useSyncExternalStore } from 'react'
import i18n from './i18next'
import { RelativeTimeFormatter } from './relative-time'

/**
 * Returns the locale that values should be formatted in: the app's language, combined with the
 * region of the system's locale when it has one (e.g. an app language of `es` on an `en-US` system
 * gives `es-US`). This keeps formatted words in the same language as the rest of the UI while
 * keeping the regional conventions (clock format, date order) the user picked in their OS, wherever
 * `Intl` has data for the combination. Combinations it doesn't know fall back to the language.
 */
export function getFormatLocale(
  appLanguage: string,
  systemLocale: string | undefined = navigator.language,
): string {
  let region: string | undefined
  try {
    region = systemLocale ? new Intl.Locale(systemLocale).region : undefined
  } catch {
    region = undefined
  }

  try {
    const locale = new Intl.Locale(appLanguage, region ? { region } : undefined)
    return locale.toString()
  } catch {
    return appLanguage
  }
}

let lastAppLanguage: string | undefined
let lastFormatLocale = getFormatLocale('en')

/**
 * Returns the locale values should currently be formatted in (see `getFormatLocale`). React
 * components should use `useFormatLocale` instead, so that they rerender when the language changes.
 */
export function currentFormatLocale(): string {
  const appLanguage = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  if (appLanguage !== lastAppLanguage) {
    lastAppLanguage = appLanguage
    lastFormatLocale = getFormatLocale(appLanguage)
  }
  return lastFormatLocale
}

function subscribeToLanguage(onChange: () => void) {
  i18n.on('languageChanged', onChange)
  return () => {
    i18n.off('languageChanged', onChange)
  }
}

/**
 * Returns the locale values should be formatted in (see `getFormatLocale`), rerendering the calling
 * component when the app language changes.
 */
export function useFormatLocale(): string {
  return useSyncExternalStore(subscribeToLanguage, currentFormatLocale)
}

/**
 * A formatter configuration that can be used in any locale. The formatter for each locale is
 * created the first time it's needed and reused afterwards, so these are cheap to use during
 * render. Create these at module level via `dateTimeFormat`, `relativeTimeFormat`, etc.
 */
export class LocaleFormat<T> {
  private readonly byLocale = new Map<string, T>()

  constructor(private readonly create: (locale: string) => T) {}

  /** Returns the formatter for `locale`. */
  forLocale(locale: string): T {
    let formatter = this.byLocale.get(locale)
    if (!formatter) {
      formatter = this.create(locale)
      this.byLocale.set(locale, formatter)
    }
    return formatter
  }

  /**
   * Returns the formatter for the current app language. This is for code that runs outside of a
   * React render (e.g. command handlers); components should use `useFormat` instead.
   */
  current(): T {
    return this.forLocale(currentFormatLocale())
  }
}

/**
 * Returns the formatter for the current app language, rerendering the calling component (and
 * returning a different formatter) when the language changes.
 */
export function useFormat<T>(format: LocaleFormat<T>): T {
  return format.forLocale(useFormatLocale())
}

export function dateTimeFormat(options: Intl.DateTimeFormatOptions) {
  return new LocaleFormat(locale => new Intl.DateTimeFormat(locale, options))
}

export function relativeTimeFormat(options: Intl.RelativeTimeFormatOptions) {
  return new LocaleFormat(locale => new RelativeTimeFormatter(locale, options))
}

export function numberFormat(options?: Intl.NumberFormatOptions) {
  return new LocaleFormat(locale => new Intl.NumberFormat(locale, options))
}

export function listFormat(options: Intl.ListFormatOptions) {
  return new LocaleFormat(locale => new Intl.ListFormat(locale, options))
}

export function durationFormat(options: Intl.DurationFormatOptions) {
  return new LocaleFormat(locale => new Intl.DurationFormat(locale, options))
}

export function collator(options: Intl.CollatorOptions) {
  return new LocaleFormat(locale => new Intl.Collator(locale, options))
}
