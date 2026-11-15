import { readFile } from 'fs/promises'
import { glob } from 'glob'
import got from 'got'
import path from 'path'
import { ALL_TRANSLATION_LANGUAGES, TranslationLanguage } from '../../../common/i18n'
import logger from '../logging/logger'
import { EMAIL_TEMPLATES_DIR, emailTemplateVersion } from './email-templates'

const API_KEY = process.env.SB_MAILGUN_KEY
const HOST = process.env.SB_CANONICAL_HOST!
const DOMAIN = process.env.SB_MAILGUN_DOMAIN
// NOTE(tec27): This is optional and only really meant to be used for testing
const MAILGUN_URL = (process.env.SB_MAILGUN_URL || `https://api.mailgun.net`) + '/v3'

/**
 * English goes first so that a newly created template's first (and so active) version is the
 * English one.
 */
const UPLOAD_ORDER = [
  TranslationLanguage.English,
  ...ALL_TRANSLATION_LANGUAGES.filter(l => l !== TranslationLanguage.English),
]

/**
 * Sends updated email templates to the mailgun API, so they can be used during the email sending
 * process. This should generally be run when the server starts up, to ensure that all templates
 * are up to date. Each language's rendering of a template is stored as its own version of that
 * template (see `emailTemplateVersion`).
 */
export async function updateEmailTemplates() {
  if (!API_KEY) {
    logger.info('Skipping email template update, no API key provided')
    return
  }

  const englishGlob = path.join(EMAIL_TEMPLATES_DIR, TranslationLanguage.English, '*.html')
  const templateNames = (await glob(englishGlob, { windowsPathsNoEscape: true })).map(file =>
    path.basename(file, '.html'),
  )

  logger.info(
    'Updating email templates, versionCodes = ' +
      JSON.stringify(
        Object.fromEntries(ALL_TRANSLATION_LANGUAGES.map(l => [l, emailTemplateVersion(HOST, l)])),
      ),
  )

  await Promise.all(
    templateNames.map(async templateName => {
      // One language at a time: the first upload of a template may need to create the template
      // itself, which concurrent uploads would race to do
      for (const language of UPLOAD_ORDER) {
        await updateTemplateLanguage(templateName, language)
      }
    }),
  )
}

async function updateTemplateLanguage(templateName: string, language: TranslationLanguage) {
  const file = path.join(EMAIL_TEMPLATES_DIR, language, templateName + '.html')
  const templateContent = await readFile(file, 'utf8')
  const versionCode = emailTemplateVersion(HOST, language)

  // Mailgun provides no way to idempotently create/update a template, so we have to ask for
  // successively broader things until we figure out what request we need to make
  let result: Record<string, any>
  const curTemplateVersion = await getTemplateVersion(templateName, versionCode)
  if (!curTemplateVersion) {
    // A template with that version doesn't exist, check if the template exists at all
    const curTemplate = await getTemplate(templateName)
    if (!curTemplate) {
      // No template exists with this name, so create it
      result = await createTemplate(templateName, path.basename(file), versionCode, templateContent)
    } else {
      // Template exists but not with the desired version code, create that version
      result = await createTemplateVersion(templateName, versionCode, templateContent)
    }
  } else {
    // A template with that version exists, check if the content matches
    // Multipart form encoding turns every line break into CRLF, so the stored copy of an upload
    // differs from the file in its line breaks alone
    const storedContent: string | undefined = curTemplateVersion.template?.version?.template
    if (normalizeLineBreaks(storedContent) !== normalizeLineBreaks(templateContent)) {
      // Update to new content
      result = await updateTemplateVersion(templateName, versionCode, templateContent)
    } else {
      // Up to date, do nothing
      result = curTemplateVersion
    }
  }

  logger.info({ result }, `email template updated: ${templateName} (${language})`)
}

function normalizeLineBreaks(content: string | undefined) {
  return content?.replaceAll('\r\n', '\n')
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
      .get(
        `${MAILGUN_URL}/${DOMAIN}/templates/${encodeURIComponent(
          templateName,
        )}/versions/${encodeURIComponent(versionCode)}`,
        {
          headers: mailgunHeaders(),
          timeout: { request: 5000 },
        },
      )
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
      .get(`${MAILGUN_URL}/${DOMAIN}/templates/${encodeURIComponent(templateName)}`, {
        headers: mailgunHeaders(),
        timeout: { request: 5000 },
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
  // Uses the native global FormData (not the `form-data` package): got rejects non-native
  // FormData with "Non-native FormData is not supported".
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
      timeout: { request: 5000 },
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
      timeout: { request: 5000 },
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
    .put(
      `${MAILGUN_URL}/${DOMAIN}/templates/${encodeURIComponent(
        templateName,
      )}/versions/${encodeURIComponent(versionCode)}`,
      {
        headers: mailgunHeaders(),
        body,
        timeout: { request: 5000 },
      },
    )
    .json<Record<string, any>>()
}
