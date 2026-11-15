import { readdirSync } from 'fs'
import path from 'path'
import { describe, expect, test } from 'vitest'
import { ALL_TRANSLATION_LANGUAGES, TranslationLanguage } from '../../../common/i18n'
import { EMAIL_TEMPLATES_DIR, emailSubject, emailTemplateVersion } from './email-templates'

describe('server/lib/mail/email-templates', () => {
  // server-rs/src/email.rs pins the same tags for the same inputs
  test.each([
    [TranslationLanguage.English, '6TWLTKiKLSzKmyewoKyh62poVoasmuXylMwYuOu5t8k='],
    [TranslationLanguage.Spanish, '+l5/wkcQvBwZd3CbFA2FcyjXzLRefO/XBjA/1bR1Apo='],
    [TranslationLanguage.Korean, 'as+XHPtOHfzf7lJxrPBnKzk50x5SaUvmH3PkHUwdLOE='],
    [TranslationLanguage.Russian, '59KZgW+Ya77H9gotZcWQ1GWVQJUxDlwkIcjs8Uye3eU='],
    [TranslationLanguage.ChineseSimplified, 'OKpDrctPc1qF+MzaOxuojE2H84Ug47w5fS4xisVxTss='],
  ])('template version tag for %s', (language, expected) => {
    expect(emailTemplateVersion('https://shieldbattery.net', language)).toBe(expected)
  })

  test('every generated template has a subject line in every language', () => {
    for (const language of ALL_TRANSLATION_LANGUAGES) {
      const templates = readdirSync(path.join(EMAIL_TEMPLATES_DIR, language))
        .filter(f => f.endsWith('.html'))
        .map(f => path.basename(f, '.html'))
      expect(templates).not.toHaveLength(0)
      for (const template of templates) {
        expect(emailSubject(template, language)).not.toBe('')
      }
    }
  })

  test('throws for a template without a subject line', () => {
    expect(() => emailSubject('not-a-template', TranslationLanguage.English)).toThrow()
  })
})
