import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import path from 'path'
import { TranslationLanguage } from '../../../common/i18n'

/**
 * The generated email templates (`pnpm gen-emails`): `<language>/<template>.html` for every
 * supported language, plus `subjects.json`.
 */
export const EMAIL_TEMPLATES_DIR = path.resolve(__dirname, '..', '..', 'email')

/**
 * Returns the tag of the Mailgun template version holding the `language` rendering of a template
 * for the server at `host`. Basing tags on the canonical host keeps servers that share a mail
 * domain (e.g. staging and production) from overwriting each other's templates.
 *
 * English uses the hash of the host alone. A server build that sends every email in English knows
 * only that tag, and has to keep finding its templates while a deploy replaces it. server-rs
 * computes the same tags (`template_version` in `server-rs/src/email.rs`); both sides pin the same
 * expected values in their tests.
 */
export function emailTemplateVersion(host: string, language: TranslationLanguage): string {
  const input = language === TranslationLanguage.English ? host : `${host}\n${language}`
  return createHash('sha256').update(input).digest('base64')
}

/** Template name -> language -> subject line, as written by `pnpm gen-emails`. */
type EmailSubjects = Record<string, Partial<Record<TranslationLanguage, string>>>

let subjects: EmailSubjects | undefined

/**
 * Returns the subject line of the `language` rendering of `templateName`, falling back to the
 * English one.
 */
export function emailSubject(templateName: string, language: TranslationLanguage): string {
  subjects ??= JSON.parse(
    readFileSync(path.join(EMAIL_TEMPLATES_DIR, 'subjects.json'), 'utf8'),
  ) as EmailSubjects
  const subject =
    subjects[templateName]?.[language] ?? subjects[templateName]?.[TranslationLanguage.English]
  if (!subject) {
    throw new Error(`No subject line for email template ${templateName}`)
  }
  return subject
}
