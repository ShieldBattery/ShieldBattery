// Downloads the Discord Social SDK files this repo pins into `discord-sdk`, from the release of
// the private ShieldBattery/discord-social-sdk repo tagged with the pinned version, then checks
// them. Needs the GitHub CLI (`gh`), logged in as someone with access to that repo; see
// docs/DISCORD_SDK.md.
//
// Usage: node tools/fetch-discord-sdk.cjs
'use strict'
const { spawnSync } = require('child_process')
const fs = require('fs')
const { checkDiscordSdk, SDK_DIR, SDK_FILES, SDK_VERSION } = require('./check-discord-sdk.cjs')

const SDK_REPO = 'ShieldBattery/discord-social-sdk'

function fetchDiscordSdk() {
  fs.mkdirSync(SDK_DIR, { recursive: true })
  const result = spawnSync(
    'gh',
    [
      'release',
      'download',
      `v${SDK_VERSION}`,
      '--repo',
      SDK_REPO,
      '--dir',
      SDK_DIR,
      '--clobber',
      ...Object.keys(SDK_FILES).flatMap(file => ['--pattern', file]),
    ],
    { stdio: 'inherit' },
  )
  if (result.error) {
    throw new Error(`Couldn't run the GitHub CLI (gh): ${result.error.message}`)
  }
  if (result.status !== 0) {
    throw new Error(
      `Couldn't download Discord Social SDK ${SDK_VERSION} from ${SDK_REPO}. Check that ` +
        '`gh auth status` shows you logged in, and that you have access to that repo.',
    )
  }

  checkDiscordSdk()
}

try {
  fetchDiscordSdk()
  console.log(`Discord Social SDK ${SDK_VERSION} is in ${SDK_DIR}.`)
} catch (err) {
  console.error(err.message)
  process.exit(1)
}
