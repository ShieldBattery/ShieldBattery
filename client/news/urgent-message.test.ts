import { describe, expect, test } from 'vitest'
import { localizeUrgentMessage } from './urgent-message'

const english = { title: 'Maintenance', message: '**Back soon**' }
const spanish = { language: 'es', title: 'Mantenimiento', message: '**Volvemos pronto**' }

describe('localizeUrgentMessage', () => {
  test('uses the selected translation for both the banner and dialog', () => {
    expect(localizeUrgentMessage({ ...english, translations: [spanish] }, 'es')).toEqual({
      title: spanish.title,
      message: spanish.message,
    })
  })

  test.each(['en', 'ko', 'fr'])('falls back to English for %s without a translation', language => {
    expect(localizeUrgentMessage({ ...english, translations: [spanish] }, language)).toEqual(
      english,
    )
  })

  test('supports stored messages without translations', () => {
    expect(localizeUrgentMessage(english, 'ru')).toEqual(english)
  })

  test('resolves regional locales using the application language rules', () => {
    expect(localizeUrgentMessage({ ...english, translations: [spanish] }, 'es-MX').title).toBe(
      spanish.title,
    )
    const chinese = { language: 'zh-Hans', title: 'Chinese title', message: 'Chinese body' }
    expect(localizeUrgentMessage({ ...english, translations: [chinese] }, 'zh-Hans').title).toBe(
      chinese.title,
    )
  })

  test('falls back independently for blank title and body fields', () => {
    expect(
      localizeUrgentMessage({ ...english, translations: [{ ...spanish, title: '  ' }] }, 'es'),
    ).toEqual({ title: english.title, message: spanish.message })
    expect(
      localizeUrgentMessage({ ...english, translations: [{ ...spanish, message: '' }] }, 'es'),
    ).toEqual({ title: spanish.title, message: english.message })
  })

  test('preserves meaningful Markdown whitespace', () => {
    const message = '    code block\n\nparagraph  \nline break'
    expect(
      localizeUrgentMessage({ ...english, translations: [{ ...spanish, message }] }, 'es').message,
    ).toBe(message)
  })
})
