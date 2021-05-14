import fs from 'fs'
import handlebars from 'handlebars'
import createMailgun from 'mailgun-js'
import path from 'path'
import thenify from 'thenify'
import log from '../logging/logger'

const asyncReadFile = thenify(fs.readFile)

const enabled = !!process.env.SB_MAILGUN_KEY

const FROM = enabled ? process.env.SB_MAILGUN_FROM : ''
const HOST = process.env.SB_CANONICAL_HOST
const mailgun = enabled
  ? createMailgun({
      apiKey: process.env.SB_MAILGUN_KEY,
      domain: process.env.SB_MAILGUN_DOMAIN,
    })
  : null

const templates = new Map()

async function readTemplate(name) {
  const htmlContents = asyncReadFile(path.join(__dirname, 'templates', name + '.html'), 'utf8')
  const textContents = asyncReadFile(path.join(__dirname, 'templates', name + '.txt'), 'utf8')
  return {
    html: handlebars.compile(await htmlContents),
    text: handlebars.compile(await textContents),
  }
}

export default async function sendMail({ to, subject, templateName, templateData }) {
  if (!templates.has(templateName)) {
    templates.set(templateName, readTemplate(templateName))
  }

  const { html: htmlTemplate, text: textTemplate } = await templates.get(templateName)
  const templateContext = { ...templateData, HOST }
  const html = htmlTemplate(templateContext)
  const text = textTemplate(templateContext)
  const mailData = {
    from: FROM,
    to,
    subject,
    html,
    text,
  }

  if (!enabled) {
    if (process.env.NODE_ENV !== 'production') {
      // In dev, we log out the emails to console to make them easy to test links, etc.
      log.debug(
        {},
        '\n\n==EMAIL==\n\nTo: ' + to + '\nSubject: ' + subject + '\nBody:\n' + text + '\n\n====',
      )
    }
    return undefined
  } else {
    return mailgun.messages().send(mailData)
  }
}
