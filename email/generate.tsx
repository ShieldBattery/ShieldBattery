import { render } from '@react-email/render'
import fs from 'fs/promises'
import { glob } from 'glob'
import path from 'path'
import React from 'react'
import { EmailProps } from './email-props'

const OUTPUT_DIR = path.resolve(__dirname, '..', 'server', 'email')

async function generateTemplates() {
  console.log('Generating email templates...\n')

  const templateGlob = path.resolve(__dirname, 'templates', '*.tsx')
  const templateFiles = await glob(templateGlob, { windowsPathsNoEscape: true })

  const oldTemplatesGlob = path.resolve(OUTPUT_DIR, '*.html')
  const oldTemplateFiles = await glob(oldTemplatesGlob, { windowsPathsNoEscape: true })

  await Promise.all(oldTemplateFiles.map(f => fs.unlink(f)))

  for (const file of templateFiles) {
    const fileName = path.basename(file, path.extname(file))
    const outputFile = path.resolve(OUTPUT_DIR, fileName + '.html')
    console.log(`templates/${fileName} -> ../server/email/${fileName}.html`)

    const Component = ((await import(file)) as any)
      .default as React.JSXElementConstructor<EmailProps>
    // TODO(tec27): Render in all supported languages
    const html = render(<Component lang='en' dir='ltr' />)

    await fs.writeFile(outputFile, html, { encoding: 'utf-8' })
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
