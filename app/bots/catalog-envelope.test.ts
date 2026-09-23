import { generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import {
  CatalogTrust,
  looksLikeEnvelope,
  openCatalogEnvelope,
  resolveCatalogTrust,
} from './catalog-envelope'

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const { privateKey: otherPrivateKey } = generateKeyPairSync('ed25519')

const trust: CatalogTrust = {
  channel: 'staging',
  keyId: 'test-key',
  publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
}

const catalog = { schemaVersion: 1, revision: 3, bots: [] }

/** Mirrors the publisher: sorted keys, no whitespace, base64 payload and 64-byte signature. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort()
      .map(k => `${JSON.stringify(k)}:${canonical(record[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function envelope(
  payloadObject: unknown,
  { key = privateKey, mutate }: { key?: typeof privateKey; mutate?: (e: any) => void } = {},
) {
  const payload = Buffer.from(canonical(payloadObject), 'utf8')
  const result: any = {
    envelopeVersion: 1,
    payload: payload.toString('base64'),
    signature: sign(null, payload, key).toString('base64'),
  }
  mutate?.(result)
  return result
}

const validPayload = {
  purpose: 'shieldbattery-bot-catalog',
  channel: 'staging',
  keyId: 'test-key',
  catalog,
}

describe('app/bots/catalog-envelope/openCatalogEnvelope', () => {
  test('returns the catalog from a correctly signed envelope', () => {
    expect(openCatalogEnvelope(envelope(validPayload), trust)).toEqual(catalog)
  })

  test('rejects a signature from another key', () => {
    expect(() =>
      openCatalogEnvelope(envelope(validPayload, { key: otherPrivateKey }), trust),
    ).toThrow(/signature doesn't match/)
  })

  test('rejects a payload changed after signing', () => {
    const tampered = envelope(validPayload, {
      mutate: e => {
        e.payload = Buffer.from(
          canonical({ ...validPayload, catalog: { ...catalog, revision: 4 } }),
        ).toString('base64')
      },
    })
    expect(() => openCatalogEnvelope(tampered, trust)).toThrow(/signature doesn't match/)
  })

  test('rejects the wrong channel, key id, or purpose even when signed by the trusted key', () => {
    expect(() =>
      openCatalogEnvelope(envelope({ ...validPayload, channel: 'production' }), trust),
    ).toThrow(/production channel/)
    expect(() => openCatalogEnvelope(envelope({ ...validPayload, keyId: 'nope' }), trust)).toThrow(
      /unrecognized key/,
    )
    expect(() =>
      openCatalogEnvelope(envelope({ ...validPayload, purpose: 'something-else' }), trust),
    ).toThrow(/not a bot catalog/)
  })

  test('rejects extra fields, other envelope versions, and non-canonical encodings', () => {
    expect(() =>
      openCatalogEnvelope(envelope(validPayload, { mutate: e => (e.extra = 1) }), trust),
    ).toThrow(/not a signed envelope/)
    expect(() =>
      openCatalogEnvelope(envelope(validPayload, { mutate: e => (e.envelopeVersion = 2) }), trust),
    ).toThrow(/not a signed envelope/)
    expect(() => openCatalogEnvelope(envelope({ ...validPayload, extra: true }), trust)).toThrow(
      /unexpected fields/,
    )
    expect(() =>
      openCatalogEnvelope(envelope(validPayload, { mutate: e => (e.payload += '\n') }), trust),
    ).toThrow(/isn't encoded/)
    expect(() =>
      openCatalogEnvelope(envelope(validPayload, { mutate: e => (e.signature = 'AAAA') }), trust),
    ).toThrow(/wrong length/)
  })

  test('rejects a configured key that is not Ed25519', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const badTrust = {
      ...trust,
      publicKey: rsa.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    }
    expect(() => openCatalogEnvelope(envelope(validPayload), badTrust)).toThrow(/not an Ed25519/)
  })
})

describe('app/bots/catalog-envelope/looksLikeEnvelope', () => {
  test('routes envelopes and bare catalogs apart', () => {
    expect(looksLikeEnvelope(envelope(validPayload))).toBe(true)
    expect(looksLikeEnvelope(catalog)).toBe(false)
    expect(looksLikeEnvelope(null)).toBe(false)
    expect(looksLikeEnvelope([])).toBe(false)
  })
})

describe('app/bots/catalog-envelope/resolveCatalogTrust', () => {
  test('development builds trust staging and production builds trust production', () => {
    expect(resolveCatalogTrust({ isDev: true, env: {} }).channel).toBe('staging')
    expect(resolveCatalogTrust({ isDev: false, env: {} }).channel).toBe('production')
  })

  test('a development environment can substitute its own signing identity', () => {
    const resolved = resolveCatalogTrust({
      isDev: true,
      env: {
        SB_BOT_CATALOG_KEY_ID: 'local',
        SB_BOT_CATALOG_PUBLIC_KEY: trust.publicKey,
      },
    })
    expect(resolved).toEqual({ channel: 'staging', keyId: 'local', publicKey: trust.publicKey })
  })

  test('a production build ignores environment overrides', () => {
    const resolved = resolveCatalogTrust({
      isDev: false,
      env: { SB_BOT_CATALOG_KEY_ID: 'local', SB_BOT_CATALOG_PUBLIC_KEY: trust.publicKey },
    })
    expect(resolved.keyId).toBe('bots-production-1')
  })
})
