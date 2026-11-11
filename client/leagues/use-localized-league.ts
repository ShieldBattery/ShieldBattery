import { useTranslation } from 'react-i18next'
import { localizeLeague } from './league-translations'

/** An empty language previews the default text without applying any translations. */
export function useLocalizedLeague(
  league: Parameters<typeof localizeLeague>[0],
  language?: string,
) {
  const { i18n } = useTranslation()
  if (language === '') {
    return localizeLeague({ ...league, translations: undefined }, 'en')
  }
  return localizeLeague(league, language ?? i18n.resolvedLanguage ?? i18n.language)
}
