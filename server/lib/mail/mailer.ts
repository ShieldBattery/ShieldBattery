import formData from 'form-data'
import Mailgun from 'mailgun.js'
import { MailgunMessageData } from 'mailgun.js/definitions'
import { resolveTranslationLanguage } from '../../../common/i18n'
import { default as log, default as logger } from '../logging/logger'
import { emailSubject, emailTemplateVersion } from './email-templates'

const enabled = !!process.env.SB_MAILGUN_KEY

const FROM = enabled ? process.env.SB_MAILGUN_FROM : ''
const HOST = process.env.SB_CANONICAL_HOST!
const DOMAIN = process.env.SB_MAILGUN_DOMAIN
const mailgunClient = enabled
  ? new Mailgun(formData).client({
      username: 'api',
      key: process.env.SB_MAILGUN_KEY!,
      // NOTE(tec27): This is optional and only really meant to be used for testing
      url: process.env.SB_MAILGUN_URL,
    })
  : undefined

/**
 * Sends an email using the specified template name and associated data to apply for variables. The
 * email (body and subject) is in the supported language that best matches `locale`, or English if
 * none does. Every template will also have the following data added:
 *
 * - `HOST`: The canonical host of the site (e.g. `https://shieldbattery.net`)
 */
export async function sendMailTemplate({
  to,
  locale,
  templateName,
  templateData,
}: {
  to: string
  /** The recipient's locale (e.g. a user's stored `locale`), if known. */
  locale: string | undefined
  templateName: string
  templateData: any
}) {
  const language = resolveTranslationLanguage(locale)
  const mailData = {
    from: FROM,
    to,
    subject: emailSubject(templateName, language),
    template: templateName,
    't:text': 'yes',
    't:variables': JSON.stringify({ ...templateData, HOST }),
    't:version': emailTemplateVersion(HOST, language),
  } satisfies MailgunMessageData

  if (!enabled) {
    if (process.env.NODE_ENV !== 'production') {
      // In dev, we log out the emails to console to make them easy to test links, etc.
      log.info({ mailData, templateVariables: { ...templateData, HOST } }, 'Sent email')
    }
    return undefined
  } else {
    try {
      return await mailgunClient?.messages.create(DOMAIN!, mailData)
    } catch (err) {
      logger.error({ err }, `mailgun error`)
      // We wrap the error because otherwise it will set the response status itself and we don't
      // want to propagate mailgun response statuses
      throw new Error('Could not send email', { cause: err })
    }
  }
}
