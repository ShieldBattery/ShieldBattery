import { generateKeyPairSync, sign } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { CatalogTrust } from './catalog-envelope'
import { loadCachedCatalog, saveCachedCatalog } from './library-store'

const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const { publicKey: otherPublicKey } = generateKeyPairSync('ed25519')

function trustFor(key: typeof publicKey): CatalogTrust {
  return {
    channel: 'staging',
    keyId: 'test-key',
    publicKey: key.export({ type: 'spki', format: 'pem' }).toString(),
  }
}

const trust = trustFor(publicKey)
const CATALOG_URL = 'https://cdn.example.test/catalog.json'

/** Keys are written pre-sorted, which is the canonical form the publisher signs. */
function signedPayload(revision: number): Buffer {
  return Buffer.from(
    JSON.stringify({
      catalog: { bots: [], revision, schemaVersion: 1 },
      channel: 'staging',
      keyId: 'test-key',
      purpose: 'shieldbattery-bot-catalog',
    }),
    'utf8',
  )
}

function signedCatalog(revision: number) {
  const payload = signedPayload(revision)
  return {
    envelopeVersion: 1,
    payload: payload.toString('base64'),
    signature: sign(null, payload, privateKey).toString('base64'),
  }
}

describe('app/bots/library-store/catalog cache', () => {
  let dir: string
  let filePath: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sb-catalog-cache-'))
    filePath = path.join(dir, 'catalog.json')
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  test('is absent until something is saved', async () => {
    expect(await loadCachedCatalog(filePath, trust)).toBeUndefined()
  })

  test('round-trips a signed catalog', async () => {
    await saveCachedCatalog(filePath, {
      fetchedAt: 1234,
      url: CATALOG_URL,
      document: signedCatalog(3),
    })
    expect(await loadCachedCatalog(filePath, trust)).toEqual({
      revision: 3,
      fetchedAt: 1234,
      url: CATALOG_URL,
      bots: [],
    })
  })

  test('rejects a cached document whose contents no longer match its signature', async () => {
    const document = { ...signedCatalog(3), payload: signedPayload(4).toString('base64') }
    await saveCachedCatalog(filePath, { fetchedAt: 1234, url: CATALOG_URL, document })
    await expect(loadCachedCatalog(filePath, trust)).rejects.toThrow(/signature doesn't match/)
  })

  test('rejects a cached document signed by a key this build does not trust', async () => {
    await saveCachedCatalog(filePath, {
      fetchedAt: 1234,
      url: CATALOG_URL,
      document: signedCatalog(3),
    })
    await expect(loadCachedCatalog(filePath, trustFor(otherPublicKey))).rejects.toThrow(
      /signature doesn't match/,
    )
  })

  test('rejects a cached bare catalog from a URL that requires a signature', async () => {
    await saveCachedCatalog(filePath, {
      fetchedAt: 1234,
      url: CATALOG_URL,
      document: { schemaVersion: 1, revision: 3, bots: [] },
    })
    await expect(loadCachedCatalog(filePath, trust)).rejects.toThrow(/not signed/)
  })

  test('rejects a cache file saved in a layout without the signed document', async () => {
    await fs.writeFile(
      filePath,
      JSON.stringify({
        schemaVersion: 1,
        revision: 3,
        fetchedAt: 1234,
        url: CATALOG_URL,
        bots: [],
      }),
    )
    await expect(loadCachedCatalog(filePath, trust)).rejects.toThrow(/layout/)
  })
})
