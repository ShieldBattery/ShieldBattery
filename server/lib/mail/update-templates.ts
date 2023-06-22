import { createHash } from 'crypto'
import FormData from 'form-data'
import { readFile } from 'fs/promises'
import { glob } from 'glob'
import got from 'got'
import path from 'path'
import logger from '../logging/logger'

const API_KEY = process.env.SB_MAILGUN_KEY
const HOST = process.env.SB_CANONICAL_HOST!
const DOMAIN = process.env.SB_MAILGUN_DOMAIN
// NOTE(tec27): This is optional and only really meant to be used for testing
const MAILGUN_URL = process.env.SB_MAILGUN_URL || `https://api.mailgun.net/v3`

/**
 * Sends updated email templates to the mailgun API, so they can be used during the email sending
 * process. This should generally be run when the server starts up, to ensure that all templates
 * are up to date.
 */
export async function updateEmailTemplates() {
  if (!API_KEY) {
    logger.info('Skipping email template update, no API key provided')
    return
  }

  const templatesGlob = path.resolve(__dirname, '..', '..', 'email', '*.html')
  const templateFiles = await glob(templatesGlob, { windowsPathsNoEscape: true })

  // We base our version code on the canonical URL so different servers on the same mail domain
  // end up with unique versions of the templates
  const versionCode = createHash('sha256').update(HOST).digest('base64') + 'a'
  logger.info('Updating email templates, versionCode = ' + versionCode)

  await Promise.all(
    templateFiles.map(async file => {
      const templateContent = await readFile(file, 'utf8')
      const templateName = path.basename(file, '.html')

      // Mailgun provides no way to idempotently create/update a template, so we have to ask for
      // successively broader things until we figure out what request we need to make
      let result: Record<string, any>
      const curTemplateVersion = await getTemplateVersion(templateName, versionCode)
      if (!curTemplateVersion) {
        // A template with that version doesn't exist, check if the template exists at all
        const curTemplate = await getTemplate(templateName)
        if (!curTemplate) {
          // No template exists with this name, so create it
          result = await createTemplate(
            templateName,
            path.basename(file),
            versionCode,
            templateContent,
          )
        } else {
          // Template exists but not with the desired version code, create that version
          result = await createTemplateVersion(templateName, versionCode, templateContent)
        }
      } else {
        // A template with that version exists, check if the content matches
        if (curTemplateVersion.template?.version?.template !== templateContent) {
          // Update to new content
          result = await updateTemplateVersion(templateName, versionCode, templateContent)
        } else {
          // Up to date, do nothing
          result = curTemplateVersion
        }
      }

      logger.info({ result }, `email template updated: ${templateName}`)
    }),
  )
}

function mailgunHeaders() {
  return {
    Authorization: 'Basic ' + btoa(`api:${API_KEY}`),
  }
}

async function getTemplateVersion(
  templateName: string,
  versionCode: string,
): Promise<Record<string, any> | undefined> {
  try {
    return await got
      .get(`${MAILGUN_URL}/${DOMAIN}/templates/${templateName}/versions/${versionCode}`, {
        headers: mailgunHeaders(),
        timeout: 5000,
      })
      .json<Record<string, any>>()
  } catch (err: any) {
    if (err.code === 'ERR_NON_2XX_3XX_RESPONSE' && err.response?.statusCode === 404) {
      return undefined
    }

    throw err
  }
}

async function getTemplate(templateName: string): Promise<Record<string, any> | undefined> {
  try {
    return await got
      .get(`${MAILGUN_URL}/${DOMAIN}/templates/${templateName}`, {
        headers: mailgunHeaders(),
        timeout: 5000,
      })
      .json<Record<string, any>>()
  } catch (err: any) {
    if (err.code === 'ERR_NON_2XX_3XX_RESPONSE' && err.response?.statusCode === 404) {
      return undefined
    }

    throw err
  }
}

async function createTemplate(
  templateName: string,
  description: string,
  versionCode: string,
  templateContent: string,
): Promise<Record<string, any>> {
  const body = new FormData()
  body.append('name', templateName)
  body.append('description', description)
  body.append('tag', versionCode)
  body.append('template', templateContent)
  body.append('engine', 'handlebars')

  return await got
    .post(`${MAILGUN_URL}/${DOMAIN}/templates`, {
      headers: mailgunHeaders(),
      body,
      timeout: 5000,
    })
    .json<Record<string, any>>()
}

async function createTemplateVersion(
  templateName: string,
  versionCode: string,
  templateContent: string,
): Promise<Record<string, any>> {
  const body = new FormData()
  body.append('tag', versionCode)
  body.append('template', templateContent)
  body.append('engine', 'handlebars')

  return await got
    .post(`${MAILGUN_URL}/${DOMAIN}/templates/${templateName}/versions`, {
      headers: mailgunHeaders(),
      body,
      timeout: 5000,
    })
    .json<Record<string, any>>()
}

async function updateTemplateVersion(
  templateName: string,
  versionCode: string,
  templateContent: string,
): Promise<Record<string, any>> {
  const body = new FormData()
  body.append('template', templateContent)
  body.append('engine', 'handlebars')

  return await got
    .put(`${MAILGUN_URL}/${DOMAIN}/templates/${templateName}/versions/${versionCode}`, {
      headers: mailgunHeaders(),
      body,
      timeout: 5000,
    })
    .json<Record<string, any>>()
}
