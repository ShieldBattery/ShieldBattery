import { createHash } from 'crypto'
import formData from 'form-data'
import Mailgun, { MailgunMessageData } from 'mailgun.js'
import log from '../logging/logger'

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

const TEMPLATE_VERSION = createHash('sha256').update(HOST).digest('base64')

/**
 * Sends an email using the specified template name and associated data to apply for variables.
 * Every template will also have the following data added:
 *
 * - `HOST`: The canonical host of the site (e.g. `https://shieldbattery.net`)
 */
export async function sendMailTemplate({
  to,
  subject,
  templateName,
  templateData,
}: {
  to: string
  subject: string
  templateName: string
  templateData: any
}) {
  const mailData = {
    from: FROM,
    to,
    subject,
    template: templateName,
    't:text': 'yes',
    't:variables': JSON.stringify({ ...templateData, HOST }),
    't:version': TEMPLATE_VERSION,
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
      // We wrap the error because otherwise it will set the response status itself and we don't
      // want to propagate mailgun response statuses
      throw new Error('Could not send email', { cause: err })
    }
  }
}
