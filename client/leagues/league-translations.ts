import { getBestLanguage } from '../i18n/language-detector'

interface LeagueContent {
  name: string
  description?: string | null
  rulesAndInfo?: string | null
  translations?: ReadonlyArray<{
    language: string
    name?: string | null
    description?: string | null
    rulesAndInfo?: string | null
  }>
}

/** Resolves each field independently so partial translations retain the default content. */
export function localizeLeague(league: LeagueContent, language: string) {
  const selectedLanguage = getBestLanguage([language])
  const translation = league.translations?.find(t => t.language === selectedLanguage)
  return {
    name: translation?.name?.trim() ? translation.name : league.name,
    description: translation?.description?.trim() ? translation.description : league.description,
    rulesAndInfo: translation?.rulesAndInfo?.trim()
      ? translation.rulesAndInfo
      : league.rulesAndInfo,
  }
}
