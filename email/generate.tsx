import fs from 'fs/promises'
import { glob } from 'glob'
import path from 'path'
import React from 'react'
import { render } from 'react-email'
import { ALL_TRANSLATION_LANGUAGES } from '../common/i18n'
import { EmailProps } from './email-props'
import i18n, { i18nextPromise } from './i18n/i18next'

const OUTPUT_DIR = path.resolve(__dirname, '..', 'server', 'email')
/**
 * Where each sender reads the subject lines from. server-rs is built with only its own directory as
 * the build context, so it needs a copy inside that directory.
 */
const SUBJECT_FILES = [
  path.join(OUTPUT_DIR, 'subjects.json'),
  path.resolve(__dirname, '..', 'server-rs', 'src', 'email-subjects.json'),
]

interface EmailTemplateModule {
  default: React.JSXElementConstructor<EmailProps>
  /** Returns the email's subject line in i18next's current language. */
  subject: () => string
}

/**
 * Renders every template in every supported language to `server/email/<language>/<template>.html`,
 * and writes the subject line of each one to the subject manifests. Strings missing from a
 * language's catalog fall back to English.
 */
async function generateTemplates() {
  console.log('Generating email templates...\n')

  await i18nextPromise

  const templateGlob = path.resolve(__dirname, 'templates', '*.tsx')
  const templateFiles = (await glob(templateGlob, { windowsPathsNoEscape: true })).sort()

  const oldOutputGlob = path.resolve(OUTPUT_DIR, '**', '*.html')
  const oldOutputFiles = await glob(oldOutputGlob, { windowsPathsNoEscape: true })
  await Promise.all(oldOutputFiles.map(f => fs.unlink(f)))
  const outputDirEntries = await fs.readdir(OUTPUT_DIR, { withFileTypes: true })
  await Promise.all(
    outputDirEntries
      .filter(e => e.isDirectory())
      .map(e => fs.rm(path.join(OUTPUT_DIR, e.name), { recursive: true })),
  )

  const templates = await Promise.all(
    templateFiles.map(async file => ({
      name: path.basename(file, path.extname(file)),
      module: (await import(file)) as EmailTemplateModule,
    })),
  )

  /** Template name -> language -> subject line. */
  const subjects: Record<string, Record<string, string>> = {}
  for (const language of ALL_TRANSLATION_LANGUAGES) {
    await i18n.changeLanguage(language)
    await fs.mkdir(path.join(OUTPUT_DIR, language))

    for (const { name, module } of templates) {
      const outputFile = path.join(OUTPUT_DIR, language, name + '.html')
      console.log(`templates/${name} -> ../server/email/${language}/${name}.html`)

      const Component = module.default
      const html = await render(<Component lang={language} dir='ltr' />)
      await fs.writeFile(outputFile, html, { encoding: 'utf-8' })

      subjects[name] ??= {}
      subjects[name][language] = module.subject()
    }
  }

  const manifest = JSON.stringify(subjects, null, 2) + '\n'
  for (const file of SUBJECT_FILES) {
    console.log(`subjects -> ${path.relative(path.resolve(__dirname, '..'), file)}`)
    await fs.writeFile(file, manifest, { encoding: 'utf-8' })
  }

  console.log('\nDone!')
}

generateTemplates().then(
  () => {},
  err => {
    console.error(err)
    process.exit(1)
  },
)
