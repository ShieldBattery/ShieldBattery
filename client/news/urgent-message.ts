import { resolveTranslationLanguage } from '../../common/i18n'

interface UrgentMessageContent {
  title: string
  message: string
  translations?: ReadonlyArray<{
    language: string
    title: string
    message: string
  }>
}

export function localizeUrgentMessage(content: UrgentMessageContent, language: string) {
  const selectedLanguage = resolveTranslationLanguage(language)
  const translation = content.translations?.find(t => t.language === selectedLanguage)
  return {
    title: translation?.title.trim() ? translation.title : content.title,
    message: translation?.message.trim() ? translation.message : content.message,
  }
}
