// Fails a build that lacks the Discord Social SDK this repo pins. The SDK ships beside the app but
// never lives in the repo; see docs/DISCORD_SDK.md.
//
// prod.yml and staging.yml run this as electron-builder's `beforePack` hook, so every build from
// them fails without the SDK. `pnpm run dist` and `diststaging` also run it first, so they fail
// before spending minutes on the client and game builds.
//
// Usage: node tools/check-discord-sdk.cjs
'use strict'
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const SDK_DIR = path.join(__dirname, '..', 'discord-sdk')
/** The SDK version the app is built and tested against. */
const SDK_VERSION = '1.10.19337'
/** The SHA-256 of each file the build ships, from that version's download. */
const SDK_FILES = {
  'discord_partner_sdk.dll': 'f9953495b0d6263cc0b926e70f00adc2e3dda478e216ac6c8b36ba23840ab8ee',
  'License-Notices.txt': 'e8afa66340c225431e69768543cc34a7240f3494a9d759189fe118620ea8eebf',
}

function checkDiscordSdk() {
  const problems = []
  for (const [file, expectedHash] of Object.entries(SDK_FILES)) {
    const filePath = path.join(SDK_DIR, file)
    if (!fs.existsSync(filePath)) {
      problems.push(`${file} is missing`)
      continue
    }
    const hash = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
    if (hash !== expectedHash) {
      problems.push(`${file} isn't the one from SDK ${SDK_VERSION}`)
    }
  }

  if (problems.length) {
    throw new Error(
      `The Discord Social SDK in ${SDK_DIR} can't be shipped: ${problems.join(', ')}. ` +
        'See docs/DISCORD_SDK.md for where to get it.',
    )
  }
}

exports.default = async function beforePack() {
  checkDiscordSdk()
}

if (require.main === module) {
  try {
    checkDiscordSdk()
  } catch (err) {
    console.error(err.message)
    process.exit(1)
  }
}
