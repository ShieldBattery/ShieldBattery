// Generates every secret/key a coordinator tenant needs, in exactly the
// formats the config files expect. Plain Node (>= 16), no dependencies:
//
//   node keygen.mjs [tenant-id]
//
// Prints a paste-ready config/tenants.json entry for the tenant plus the env
// values that go with it, so adding a tenant is: run this, paste the entry,
// set the env var, restart the coordinator. Nothing touches AWS or the relay
// fleet — relays learn tenant keys from the coordinator over their control
// connection. Nothing is written to disk and nothing is sent anywhere — copy
// what you need and close the terminal.

import { Buffer } from 'node:buffer'
import { generateKeyPairSync, randomBytes } from 'node:crypto'
import process from 'node:process'

const tenantId = (process.argv[2] ?? 'CHANGEME').toLowerCase()
// The env var carrying the tenant's signing key. tenants.json's
// "signing_key_env" and the coordinator .env must use the same (renamable)
// name.
const signingKeyEnv = `COORDINATOR_TENANT_${tenantId.replace(/[^a-z0-9]+/gi, '_').toUpperCase()}_SIGNING_KEY`
// Key ids are dated so a future rotation can mint `<id>-<newer date>` and
// retire this one.
const now = new Date()
const kid = `${tenantId}-${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`

// Raw 32-byte Ed25519 seed from a PKCS#8 DER export (fixed 16-byte header).
const seedFromPkcs8 = der => der.subarray(16)
// Raw 32-byte Ed25519 public key from an SPKI DER export (fixed 12-byte header).
const rawFromSpki = der => der.subarray(12)

// Assembles a PKCS#8 *v2* Ed25519 document (RFC 5958: version 1, private key,
// and the [1]-tagged public key attribute). Node only exports v1 (seed alone),
// but the coordinator parses with ring's `Ed25519KeyPair::from_pkcs8`, which
// requires v2 — the embedded public key is what lets it verify the pair without
// trusting the seed blindly.
const pkcs8V2 = (seed, publicKey) =>
  Buffer.concat([
    Buffer.from([0x30, 0x53]), // SEQUENCE, 83 bytes
    Buffer.from([0x02, 0x01, 0x01]), // INTEGER 1 (PKCS#8 v2)
    Buffer.from([0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70]), // AlgorithmIdentifier: Ed25519
    Buffer.from([0x04, 0x22, 0x04, 0x20]), // OCTET STRING wrapping CurvePrivateKey
    seed,
    Buffer.from([0xa1, 0x23, 0x03, 0x21, 0x00]), // [1] publicKey BIT STRING
    publicKey,
  ])

// The coordinator's own signing key for the tenant (mints player tokens, signs
// webhooks). Stored as base64 PKCS#8 v2 in the env var tenants.json names.
const signing = generateKeyPairSync('ed25519')
const signingSeed = seedFromPkcs8(signing.privateKey.export({ type: 'pkcs8', format: 'der' }))
const signingPub = rawFromSpki(signing.publicKey.export({ type: 'spki', format: 'der' }))
const signingPkcs8B64 = pkcs8V2(signingSeed, signingPub).toString('base64')

// The app server's request-signing keypair: the SEED goes to the app server
// (SB_RP2_CLIENT_KEY), the PUBLIC key goes in the tenant's client_pubkeys.
const client = generateKeyPairSync('ed25519')
const clientSeedHex = seedFromPkcs8(client.privateKey.export({ type: 'pkcs8', format: 'der' })).toString('hex')
const clientPubHex = rawFromSpki(client.publicKey.export({ type: 'spki', format: 'der' })).toString('hex')

const tenantEntry = {
  id: tenantId,
  state: 'active',
  kid,
  signing_key_env: signingKeyEnv,
  client_pubkeys: [clientPubHex],
  notify_url: 'https://CHANGEME/webhooks/netcode-v2/game-events',
  bounds: { min: 1, max: 12 },
}

const bootstrapSecret = randomBytes(32).toString('hex')

console.log(`
── config/tenants.json — add this entry to "tenants" ──────────────────────────
${JSON.stringify(tenantEntry, null, 2)}

── coordinator .env ────────────────────────────────────────────────────────────
${signingKeyEnv}=${signingPkcs8B64}
   (This is the coordinator's OWN signing identity for the tenant — it mints
    player tokens and signs webhooks — not a tenant-held secret.)

── tenant's app server .env (KEEP SECRET — its request-signing key) ────────────
SB_RP2_CLIENT_KEY=${clientSeedHex}

That's a complete tenant: paste, set the env var, restart the coordinator.

── ONLY when standing up a NEW coordinator box (per-box, not per-tenant) ───────
COORDINATOR_BOOTSTRAP_SECRET=${bootstrapSecret}
   (Relays present this to enroll — RELAY_COORDINATOR_SECRET, injected from SSM
    by the ECS task definition; pass the same value as
    TF_VAR_coordinator_bootstrap_secret when applying the relay-fleet
    Terraform. Ignore it when merely adding a tenant to an existing box.)
`)
