// Fetches a session's flight-recorder blobs from a rally-point2 coordinator, or one
// relay's blob verbatim. Plain Node (>= 18, for global fetch; this repo requires >=
// 24), no dependencies:
//
//   node fetch-flight.mjs <coordinator-url> <session>            # list what's stored
//   node fetch-flight.mjs <coordinator-url> <session> <relay_id>  # fetch one blob
//
// Needs the tenant's own request-signing credentials — the same ones the app server
// signs its coordinator requests with (see server/lib/netcode-v2/netcode-v2-service.ts):
// SB_RP2_TENANT / SB_RP2_CLIENT_KEY in the environment, or --tenant / --key flags.
// With no relay_id, prints the session's stored-recording listing. With one, writes
// that recording's JSON to stdout — redirect to a file to save it.

import { Buffer } from 'node:buffer'
import { createPrivateKey, sign } from 'node:crypto'
import process from 'node:process'

function flag(name) {
  const withEquals = process.argv.find(a => a.startsWith(`--${name}=`))
  if (withEquals) return withEquals.slice(name.length + 3)
  const i = process.argv.indexOf(`--${name}`)
  return i !== -1 ? process.argv[i + 1] : undefined
}

const positional = process.argv.slice(2).filter(a => !a.startsWith('--'))
const [coordinatorUrl, sessionArg, relayIdArg] = positional
if (!coordinatorUrl || sessionArg === undefined) {
  console.error('usage: node fetch-flight.mjs <coordinator-url> <session> [relay_id]')
  process.exit(1)
}

const tenant = flag('tenant') ?? process.env.SB_RP2_TENANT
const seedHex = flag('key') ?? process.env.SB_RP2_CLIENT_KEY
if (!tenant) {
  console.error('set SB_RP2_TENANT or pass --tenant <tenant-id>')
  process.exit(1)
}
if (!seedHex || !/^[0-9a-f]{64}$/i.test(seedHex)) {
  console.error('set SB_RP2_CLIENT_KEY (64 hex characters) or pass --key <seed-hex>')
  process.exit(1)
}

// The fixed 16-byte PKCS#8 v1 DER prefix for an Ed25519 private key; the raw 32-byte
// seed follows it to form the document Node's createPrivateKey accepts. Mirrors
// server/lib/netcode-v2/netcode-v2-service.ts's PKCS8_V1_ED25519_PREFIX byte-for-byte,
// so this script signs exactly like the app server does from the same seed.
const PKCS8_V1_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')
const clientKey = createPrivateKey({
  key: Buffer.concat([PKCS8_V1_ED25519_PREFIX, Buffer.from(seedHex, 'hex')]),
  format: 'der',
  type: 'pkcs8',
})

// Signs `rp2-request-v1:<unix seconds>:<METHOD>:<path>:<raw body>` — the message shape
// and header pair every tenant-signed coordinator request uses.
function signRequest(method, path, body) {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const message = Buffer.concat([
    Buffer.from(`rp2-request-v1:${timestamp}:${method.toUpperCase()}:${path}:`, 'utf8'),
    Buffer.from(body, 'utf8'),
  ])
  return {
    'x-rp2-timestamp': timestamp,
    'x-rp2-signature': sign(null, message, clientKey).toString('hex'),
  }
}

async function signedPost(path, bodyObj) {
  const body = JSON.stringify(bodyObj)
  try {
    return await fetch(new URL(path, coordinatorUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...signRequest('POST', path, body) },
      body,
    })
  } catch (error) {
    console.error(`could not reach ${coordinatorUrl}: ${error.cause?.message ?? error.message}`)
    process.exit(1)
  }
}

const session = Number(sessionArg)
if (!Number.isInteger(session)) {
  console.error(`session must be an integer, got ${sessionArg}`)
  process.exit(1)
}

if (relayIdArg === undefined) {
  const res = await signedPost('/flight/blobs', { tenant, session })
  if (!res.ok) {
    console.error(`coordinator returned ${res.status}`)
    process.exit(1)
  }
  const { blobs } = await res.json()
  if (blobs.length === 0) {
    console.error(`no stored recordings for session ${session}`)
  } else {
    console.log(JSON.stringify(blobs, null, 2))
  }
} else {
  const relayId = Number(relayIdArg)
  if (!Number.isInteger(relayId)) {
    console.error(`relay_id must be an integer, got ${relayIdArg}`)
    process.exit(1)
  }
  const res = await signedPost('/flight/blob', { tenant, session, relay_id: relayId })
  if (res.status === 404) {
    console.error(`no recording for session ${session} relay ${relayId}`)
    process.exit(1)
  }
  if (!res.ok) {
    console.error(`coordinator returned ${res.status}`)
    process.exit(1)
  }
  process.stdout.write(await res.text())
}
