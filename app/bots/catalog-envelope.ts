/**
 * The published bot catalog is wrapped in a signed envelope. Only a catalog whose signature checks
 * out against the key pinned here for its channel is ever parsed further, and the key inside a
 * catalog (or anywhere else on the network) is never what decides trust.
 */

import { createPublicKey, KeyObject, verify } from 'node:crypto'

export type CatalogChannel = 'staging' | 'production'

export interface CatalogTrust {
  channel: CatalogChannel
  keyId: string
  /** PEM-encoded Ed25519 public key. */
  publicKey: string
}

/** The value a signed payload's `purpose` must carry; it keeps a signature from meaning anything else. */
const CATALOG_PURPOSE = 'shieldbattery-bot-catalog'

const ENVELOPE_KEYS = 'envelopeVersion,payload,signature'
const PAYLOAD_KEYS = 'catalog,channel,keyId,purpose'
const SIGNATURE_BYTES = 64

/** Public keys the catalog publisher signs with, one per channel. */
export const CATALOG_TRUST: Readonly<Record<CatalogChannel, CatalogTrust>> = {
  staging: {
    channel: 'staging',
    keyId: 'bots-staging-1',
    publicKey: `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAWWg75uWzjx9RcC3Sf+7/H8x0FM2Rt1hkjbixb9Nr//0=
-----END PUBLIC KEY-----`,
  },
  production: {
    channel: 'production',
    keyId: 'bots-production-1',
    publicKey: `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA0K8idtedwr6yqHcehuWdaVIGU4YAw+rMO4LneXFRe+s=
-----END PUBLIC KEY-----`,
  },
}

/**
 * Picks the trust for this build, letting a development environment point at another signing
 * identity (`SB_BOT_CATALOG_CHANNEL`, `SB_BOT_CATALOG_KEY_ID`, `SB_BOT_CATALOG_PUBLIC_KEY`) when it
 * serves its own signed catalog.
 */
export function resolveCatalogTrust({
  isDev,
  env = process.env,
}: {
  isDev: boolean
  env?: NodeJS.ProcessEnv
}): CatalogTrust {
  let channel: CatalogChannel = isDev ? 'staging' : 'production'
  if (env.SB_BOT_CATALOG_CHANNEL === 'production' || env.SB_BOT_CATALOG_CHANNEL === 'staging') {
    channel = env.SB_BOT_CATALOG_CHANNEL
  }
  const base = CATALOG_TRUST[channel]
  if (isDev && env.SB_BOT_CATALOG_KEY_ID && env.SB_BOT_CATALOG_PUBLIC_KEY) {
    return {
      channel,
      keyId: env.SB_BOT_CATALOG_KEY_ID,
      publicKey: env.SB_BOT_CATALOG_PUBLIC_KEY,
    }
  }
  return base
}

function loadPublicKey(pem: string): KeyObject {
  let key: KeyObject
  try {
    key = createPublicKey(pem)
  } catch {
    throw new Error('The configured catalog signing key is not a valid public key')
  }
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error('The configured catalog signing key is not an Ed25519 key')
  }
  return key
}

/** Decodes canonical base64 only: any other encoding of the same bytes is rejected. */
function decodeBase64(value: unknown, what: string): Buffer {
  if (typeof value !== 'string') {
    throw new Error(`The bot catalog's ${what} is missing`)
  }
  const bytes = Buffer.from(value, 'base64')
  if (bytes.toString('base64') !== value) {
    throw new Error(`The bot catalog's ${what} isn't encoded the way the publisher writes it`)
  }
  return bytes
}

/**
 * Whether a document is shaped like a signed envelope at all, as opposed to a bare catalog. This
 * only routes the document; it makes no statement about validity.
 */
export function looksLikeEnvelope(document: unknown): boolean {
  return (
    typeof document === 'object' &&
    document !== null &&
    !Array.isArray(document) &&
    'envelopeVersion' in document
  )
}

/**
 * Verifies a signed envelope and returns the catalog it carries. Every check is against the exact
 * bytes the publisher signed; the payload is parsed only after the signature verifies.
 */
export function openCatalogEnvelope(document: unknown, trust: CatalogTrust): unknown {
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    throw new Error('The bot catalog is not a signed envelope')
  }
  const envelope = document as Record<string, unknown>
  if (Object.keys(envelope).sort().join(',') !== ENVELOPE_KEYS || envelope.envelopeVersion !== 1) {
    throw new Error('The bot catalog is not a signed envelope this app understands')
  }

  const payload = decodeBase64(envelope.payload, 'signed content')
  const signature = decodeBase64(envelope.signature, 'signature')
  if (signature.length !== SIGNATURE_BYTES) {
    throw new Error(`The bot catalog's signature has the wrong length`)
  }
  if (!verify(null, payload, loadPublicKey(trust.publicKey), signature)) {
    throw new Error(`The bot catalog's signature doesn't match the ${trust.channel} signing key`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(payload.toString('utf8'))
  } catch {
    throw new Error(`The bot catalog's signed content isn't valid JSON`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`The bot catalog's signed content isn't an object`)
  }
  const inner = parsed as Record<string, unknown>
  if (Object.keys(inner).sort().join(',') !== PAYLOAD_KEYS) {
    throw new Error(`The bot catalog's signed content has unexpected fields`)
  }
  if (inner.purpose !== CATALOG_PURPOSE) {
    throw new Error('The signed document is not a bot catalog')
  }
  if (inner.channel !== trust.channel) {
    throw new Error(
      `The bot catalog was published for the ${String(inner.channel)} channel, not ${trust.channel}`,
    )
  }
  if (inner.keyId !== trust.keyId) {
    throw new Error(`The bot catalog was signed with an unrecognized key (${String(inner.keyId)})`)
  }
  return inner.catalog
}
