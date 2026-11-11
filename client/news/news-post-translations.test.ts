import { describe, expect, test } from 'vitest'
import { TranslationLanguage } from '../../common/i18n'
import {
  fromTranslationFields,
  localizeNewsPost,
  newsPostFormField,
  toTranslationFields,
} from './news-post-translations'

const english = { title: 'Update', summary: 'New things', content: '**Lots** of new things' }
const spanish = {
  language: 'es',
  title: 'Actualización',
  summary: 'Novedades',
  content: '**Muchas** novedades',
}

describe('localizeNewsPost', () => {
  test('uses the translation for the selected language', () => {
    expect(localizeNewsPost({ ...english, translations: [spanish] }, 'es')).toMatchObject({
      title: spanish.title,
      summary: spanish.summary,
      content: spanish.content,
    })
  })

  test.each(['en', 'ko', 'fr'])('falls back to the default text for %s', language => {
    expect(localizeNewsPost({ ...english, translations: [spanish] }, language)).toMatchObject(
      english,
    )
  })

  test('supports posts without translations', () => {
    expect(localizeNewsPost(english, 'ru')).toMatchObject(english)
  })

  test('resolves regional locales using the application language rules', () => {
    expect(localizeNewsPost({ ...english, translations: [spanish] }, 'es-MX').title).toBe(
      spanish.title,
    )
  })

  test.each([null, undefined, '', ' \n\t'])(
    'falls back per field for a blank value (%j)',
    blank => {
      expect(
        localizeNewsPost({ ...english, translations: [{ ...spanish, title: blank }] }, 'es'),
      ).toMatchObject({
        title: english.title,
        summary: spanish.summary,
        content: spanish.content,
      })
      expect(
        localizeNewsPost({ ...english, translations: [{ ...spanish, content: blank }] }, 'es'),
      ).toMatchObject({
        title: spanish.title,
        summary: spanish.summary,
        content: english.content,
      })
    },
  )

  test('keeps fields that a query did not select unset', () => {
    const post = { id: 'post', title: 'Update', translations: [{ language: 'es', title: 'Hola' }] }

    expect(localizeNewsPost(post, 'es')).toEqual({ ...post, title: 'Hola' })
  })

  test('preserves meaningful Markdown whitespace', () => {
    const content = '    code block\n\nparagraph  \nline break'

    expect(
      localizeNewsPost({ ...english, translations: [{ ...spanish, content }] }, 'es').content,
    ).toBe(content)
  })
})

describe('newsPostFormField', () => {
  test('uses the plain fields for the default text', () => {
    expect(newsPostFormField(TranslationLanguage.English, 'content')).toBe('content')
  })

  test('uses a separate field per language', () => {
    expect(newsPostFormField(TranslationLanguage.ChineseSimplified, 'title')).toBe('zh-HansTitle')
    expect(newsPostFormField(TranslationLanguage.Korean, 'summary')).toBe('koSummary')
  })
})

describe('translation form fields', () => {
  test('round trip stored translations', () => {
    const translations = [
      { language: 'es', title: 'Hola', summary: undefined, content: 'Contenido' },
      { language: 'ko', title: undefined, summary: '요약', content: undefined },
    ]

    expect(fromTranslationFields(toTranslationFields(translations))).toEqual(
      expect.arrayContaining(translations),
    )
    expect(fromTranslationFields(toTranslationFields(translations))).toHaveLength(2)
  })

  test('produce the same result whatever order translations are stored in', () => {
    const es = { language: 'es', title: 'Hola' }
    const ko = { language: 'ko', title: '안녕' }

    expect(fromTranslationFields(toTranslationFields([es, ko]))).toEqual(
      fromTranslationFields(toTranslationFields([ko, es])),
    )
  })

  test('default to empty and save nothing', () => {
    const fields = toTranslationFields()

    expect(fields.esTitle).toBe('')
    expect(fromTranslationFields(fields)).toEqual([])
  })

  test('omit languages containing only whitespace', () => {
    expect(
      fromTranslationFields({
        ...toTranslationFields(),
        esTitle: '  ',
        esSummary: '\n',
        esContent: ' \n\t',
      }),
    ).toEqual([])
  })

  test('trim titles and summaries but not content', () => {
    const content = '    code block\n'

    expect(
      fromTranslationFields({
        ...toTranslationFields(),
        esTitle: '  Hola  ',
        esSummary: ' Resumen\n',
        esContent: content,
      }),
    ).toEqual([{ language: 'es', title: 'Hola', summary: 'Resumen', content }])
  })
})
