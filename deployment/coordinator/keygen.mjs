// Generates every secret/key the coordinator deployment needs, in exactly the
// formats the config files expect. Plain Node (>= 16), no dependencies:
//
//   node keygen.mjs
//
// Prints values for a NEW tenant + box; run it once per environment (staging,
// prod) and paste the outputs where each label says. Nothing is written to
// disk and nothing is sent anywhere — copy what you need and close the
// terminal.

import { generateKeyPairSync, randomBytes } from 'node:crypto'

// Raw 32-byte Ed25519 seed from a PKCS#8 DER export (fixed 16-byte header).
const seedFromPkcs8 = der => der.subarray(16)
// Raw 32-byte Ed25519 public key from an SPKI DER export (fixed 12-byte header).
const rawFromSpki = der => der.subarray(12)

// The coordinator's own signing key for the tenant (mints player tokens, signs
// webhooks). Stored as base64 PKCS#8 in the env var tenants.json names.
const signing = generateKeyPairSync('ed25519')
const signingPkcs8B64 = signing.privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64')

// The app server's request-signing keypair: the SEED goes to the app server
// (SB_RP2_CLIENT_KEY), the PUBLIC key goes in the tenant's client_pubkeys.
const client = generateKeyPairSync('ed25519')
const clientSeedHex = seedFromPkcs8(client.privateKey.export({ type: 'pkcs8', format: 'der' })).toString('hex')
const clientPubHex = rawFromSpki(client.publicKey.export({ type: 'spki', format: 'der' })).toString('hex')

const bootstrapSecret = randomBytes(32).toString('hex')

console.log(`
── coordinator .env ────────────────────────────────────────────────────────────
COORDINATOR_BOOTSTRAP_SECRET=${bootstrapSecret}
COORDINATOR_TENANT_<NAME>_SIGNING_KEY=${signingPkcs8B64}
   (rename <NAME>; tenants.json's "signing_key_env" must match the final name)

── config/tenants.json ─────────────────────────────────────────────────────────
"client_pubkeys": ["${clientPubHex}"]

── app server .env (KEEP SECRET — this is the tenant's request-signing key) ────
SB_RP2_CLIENT_KEY=${clientSeedHex}

Relays enrolling against this coordinator present the bootstrap secret via
RELAY_COORDINATOR_SECRET (the ECS task definition injects it from SSM).
`)
