// Fails a release build that lacks the Discord Social SDK, which ships beside the app but never lives
// in the repo. See docs/DISCORD_SDK.md.
import { existsSync } from 'node:fs'
import path from 'node:path'

const SDK_DIR = path.join(import.meta.dirname, '..', 'discord-sdk')
const REQUIRED_FILES = ['discord_partner_sdk.dll', 'License-Notices.txt']

const missing = REQUIRED_FILES.filter(file => !existsSync(path.join(SDK_DIR, file)))
if (missing.length) {
  console.error(
    `The Discord Social SDK is missing from ${SDK_DIR} (${missing.join(', ')}). ` +
      'See docs/DISCORD_SDK.md for where to get it.',
  )
  process.exit(1)
}
