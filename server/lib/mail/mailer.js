import fs from 'fs'
import path from 'path'
import createMailgun from 'mailgun-js'
import handlebars from 'handlebars'
import thenify from 'thenify'
import config from '../../config.js'

const asyncReadFile = thenify(fs.readFile)

const enabled = !!config.mailgun

const FROM = enabled ? config.mailgun.from : ''
const HOST = config.canonicalHost
const mailgun = enabled
  ? createMailgun({
      apiKey: config.mailgun.apiKey,
      domain: config.mailgun.domain,
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
    return undefined
  } else {
    return mailgun.messages().send(mailData)
  }
}
