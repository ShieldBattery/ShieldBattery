import { useTranslation } from 'react-i18next'
import { ALL_TRANSLATION_LANGUAGES, TranslationLanguage } from '../../common/i18n'
import { getBestLanguage } from '../i18n/language-detector'

export type NewsPostTranslationLanguage = Exclude<TranslationLanguage, TranslationLanguage.English>

export const NEWS_POST_TRANSLATION_LANGUAGES = ALL_TRANSLATION_LANGUAGES.filter(
  (language): language is NewsPostTranslationLanguage => language !== TranslationLanguage.English,
)

interface NewsPostTranslationText {
  language: string
  title?: string | null
  summary?: string | null
  content?: string | null
}

interface NewsPostText {
  title: string
  summary?: string | null
  content?: string | null
  translations?: ReadonlyArray<NewsPostTranslationText>
}

/**
 * Returns `post` with its text in `language`. Each field resolves independently, so a partial
 * translation keeps the default text for whatever it leaves blank.
 */
export function localizeNewsPost<T extends NewsPostText>(post: T, language: string): T {
  const selectedLanguage = getBestLanguage([language])
  const translation = post.translations?.find(t => t.language === selectedLanguage)
  return {
    ...post,
    title: translation?.title?.trim() ? translation.title : post.title,
    summary: translation?.summary?.trim() ? translation.summary : post.summary,
    content: translation?.content?.trim() ? translation.content : post.content,
  }
}

/** Localizes a news post for the app's current language, updating when the language changes. */
export function useLocalizedNewsPost<T extends NewsPostText>(post: T): T
export function useLocalizedNewsPost<T extends NewsPostText>(
  post: T | null | undefined,
): T | undefined
export function useLocalizedNewsPost<T extends NewsPostText>(
  post: T | null | undefined,
): T | undefined {
  const { i18n } = useTranslation()
  return post ? localizeNewsPost(post, i18n.resolvedLanguage ?? i18n.language) : undefined
}

export type NewsPostTranslatedField = 'title' | 'summary' | 'content'

const FIELD_SUFFIXES = {
  title: 'Title',
  summary: 'Summary',
  content: 'Content',
} as const

/** The editor form's flattened translations, with one string per language and field. */
export type NewsPostTranslationFields = Record<
  `${NewsPostTranslationLanguage}${(typeof FIELD_SUFFIXES)[NewsPostTranslatedField]}`,
  string
>

/**
 * Returns the editor form field holding `field` in `language`. English is the post's default text,
 * which lives in the form's plain `title`/`summary`/`content` fields.
 */
export function newsPostFormField<F extends NewsPostTranslatedField>(
  language: TranslationLanguage,
  field: F,
): F | keyof NewsPostTranslationFields {
  return language === TranslationLanguage.English
    ? field
    : (`${language}${FIELD_SUFFIXES[field]}` as keyof NewsPostTranslationFields)
}

/** Flattens a post's stored translations into the editor form's per-language fields. */
export function toTranslationFields(
  translations: ReadonlyArray<NewsPostTranslationText> = [],
): NewsPostTranslationFields {
  const fields = {} as NewsPostTranslationFields
  for (const language of NEWS_POST_TRANSLATION_LANGUAGES) {
    const translation = translations.find(t => t.language === language)
    for (const field of ['title', 'summary', 'content'] as const) {
      fields[newsPostFormField(language, field) as keyof NewsPostTranslationFields] =
        translation?.[field] ?? ''
    }
  }
  return fields
}

/**
 * Collects the editor form's per-language fields into translations to save. Titles and summaries
 * are trimmed like the default text is, and languages with nothing entered are left out. Content
 * keeps its whitespace, which can be meaningful in Markdown.
 */
export function fromTranslationFields(fields: NewsPostTranslationFields) {
  return NEWS_POST_TRANSLATION_LANGUAGES.flatMap(language => {
    const fieldValue = (field: NewsPostTranslatedField) =>
      fields[newsPostFormField(language, field) as keyof NewsPostTranslationFields]

    const title = fieldValue('title').trim()
    const summary = fieldValue('summary').trim()
    const content = fieldValue('content').trim() ? fieldValue('content') : ''
    return title || summary || content
      ? [
          {
            language,
            title: title || undefined,
            summary: summary || undefined,
            content: content || undefined,
          },
        ]
      : []
  })
}
