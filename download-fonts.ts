import { download } from 'google-fonts-helper'
import path from 'path'

/**
 * A URL for all the Google fonts used in the app. This will be used at build time to download the
 * necessary fonts for self-hosting.
 */
const GOOGLE_FONTS_URL =
  'https://fonts.googleapis.com/css2' +
  '?family=Cabin:wdth,wght@75,400;75,500' +
  '&family=Inter:wght@300;400;500' +
  '&display=swap'

async function doDownload() {
  const electronDownloader = download(GOOGLE_FONTS_URL, {
    base64: false,
    overwriting: true,
    outputDir: path.join(__dirname, 'app', 'assets', 'fonts'),
    stylePath: 'fonts.css',
    fontsDir: '',
    fontsPath: '.',
  })

  electronDownloader.hook('download-font:before', font => {
    console.log(`Processing ${font.inputFont} -> ${font.outputFont}`)
  })

  console.log('Downloading fonts for Electron...')
  await electronDownloader.execute()
  console.log('Done!')

  const webDownloader = download(GOOGLE_FONTS_URL, {
    base64: false,
    overwriting: true,
    outputDir: path.join(__dirname, 'server', 'public', 'fonts'),
    stylePath: 'fonts.css',
    fontsDir: '',
    fontsPath: '.',
  })

  webDownloader.hook('download-font:before', font => {
    console.log(`Processing ${font.inputFont} -> ${font.outputFont}`)
  })

  console.log('Downloading fonts for Web...')
  await webDownloader.execute()
  console.log('Done!')
}

doDownload().then(
  () => {
    console.log('All done!')
  },
  err => {
    console.error(err)
  },
)
