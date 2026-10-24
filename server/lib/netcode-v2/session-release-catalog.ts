import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { singleton } from 'tsyringe'
import { ReadonlyDeep } from 'type-fest'
import { readFileStream } from '../files'

const MAX_CATALOG_BYTES = 512 * 1024
const MAX_METADATA_BYTES = 32 * 1024
const LOAD_TIMEOUT_MS = 10_000
const HEX_32 = /^[0-9a-f]{64}$/i

type ReleaseEnvironment = 'dev' | 'staging' | 'production'

export interface SessionReleaseKey {
  readonly keyId: number
  readonly publicKey: string
}

const EMPTY_KEYS: readonly SessionReleaseKey[] = Object.freeze([])

export type SessionReleaseCatalogSnapshot = ReadonlyDeep<{
  format: 1
  environment: ReleaseEnvironment
  kind: 'game'
  clientKeys?: SessionReleaseKey[]
  releases: Array<{
    version: string
    artifacts: Array<{
      arch: 'x86' | 'x64'
      keyId: number
      publicKey: string
      sha256: string
      metadata: string
    }>
  }>
}>

function invalidCatalog(): never {
  throw new Error('Invalid session release catalog')
}

function objectWithKeys(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidCatalog()
  const object = value as Record<string, unknown>
  if (
    Object.keys(object).length !== keys.length ||
    !keys.every(key => Object.hasOwn(object, key))
  ) {
    invalidCatalog()
  }
  return object
}

function hex(value: unknown): string {
  if (typeof value !== 'string' || !HEX_32.test(value)) invalidCatalog()
  return value.toLowerCase()
}

function parseCatalog(
  bytes: Buffer,
  environment: ReleaseEnvironment,
): SessionReleaseCatalogSnapshot {
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    invalidCatalog()
  }
  const root = objectWithKeys(parsed, [
    'format',
    'environment',
    'kind',
    'releases',
    ...(parsed && typeof parsed === 'object' && Object.hasOwn(parsed, 'clientKeys')
      ? ['clientKeys']
      : []),
  ])
  if (root.format !== 1 || root.environment !== environment || root.kind !== 'game')
    invalidCatalog()
  if (!Array.isArray(root.releases) || root.releases.length < 1 || root.releases.length > 8) {
    invalidCatalog()
  }
  const versions = new Set<string>()
  const keyIds = new Set<number>()
  const publicKeys = new Set<string>()
  const releases = root.releases.map(value => {
    const release = objectWithKeys(value, ['version', 'artifacts'])
    const { version } = release
    if (
      typeof version !== 'string' ||
      !version.trim() ||
      version.length > 128 ||
      versions.has(version)
    ) {
      invalidCatalog()
    }
    versions.add(version)
    if (!Array.isArray(release.artifacts) || release.artifacts.length !== 2) invalidCatalog()
    const arches = new Set<string>()
    const artifacts = release.artifacts.map(value => {
      const artifact = objectWithKeys(value, ['arch', 'keyId', 'publicKey', 'sha256', 'metadata'])
      const { arch, keyId, metadata } = artifact
      if ((arch !== 'x86' && arch !== 'x64') || arches.has(arch)) invalidCatalog()
      arches.add(arch)
      if (
        typeof keyId !== 'number' ||
        !Number.isInteger(keyId) ||
        keyId < 0 ||
        keyId > 0xffffffff ||
        keyIds.has(keyId)
      ) {
        invalidCatalog()
      }
      keyIds.add(keyId)
      const publicKey = hex(artifact.publicKey)
      if (publicKeys.has(publicKey)) invalidCatalog()
      publicKeys.add(publicKey)
      if (typeof metadata !== 'string' || metadata.length > Math.ceil(MAX_METADATA_BYTES / 3) * 4) {
        invalidCatalog()
      }
      const decoded = Buffer.from(metadata, 'base64')
      if (decoded.length > MAX_METADATA_BYTES || decoded.toString('base64') !== metadata) {
        invalidCatalog()
      }
      return Object.freeze({ arch, keyId, publicKey, sha256: hex(artifact.sha256), metadata })
    })
    return Object.freeze({ version, artifacts: Object.freeze(artifacts) })
  })
  let clientKeys: readonly SessionReleaseKey[] | undefined
  if (root.clientKeys !== undefined) {
    if (!Array.isArray(root.clientKeys) || !root.clientKeys.length || root.clientKeys.length > 8)
      invalidCatalog()
    clientKeys = Object.freeze(
      root.clientKeys.map(value => {
        const key = objectWithKeys(value, ['keyId', 'publicKey'])
        const { keyId } = key
        const publicKey = hex(key.publicKey)
        if (
          typeof keyId !== 'number' ||
          !Number.isInteger(keyId) ||
          keyId < 0 ||
          keyId > 0xffffffff ||
          keyIds.has(keyId) ||
          publicKeys.has(publicKey)
        )
          invalidCatalog()
        keyIds.add(keyId)
        publicKeys.add(publicKey)
        return Object.freeze({ keyId, publicKey })
      }),
    )
  }
  return Object.freeze({
    format: 1,
    environment,
    kind: 'game',
    releases: Object.freeze(releases),
    ...(clientKeys ? { clientKeys } : {}),
  })
}

async function readCatalog(key: string): Promise<Buffer> {
  let stream: Readable | undefined
  let expired = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((resolve, reject) => {
    timer = setTimeout(() => {
      expired = true
      stream?.destroy()
      reject(new Error('Session release catalog load timed out'))
    }, LOAD_TIMEOUT_MS)
  })
  const reading = (async () => {
    const opened = await readFileStream(key)
    stream = opened.stream
    // Opening storage requests cannot be cancelled; close a stream that arrives after the deadline.
    if (expired) {
      stream.destroy()
      throw new Error('Session release catalog load timed out')
    }
    if (opened.size !== undefined && opened.size > MAX_CATALOG_BYTES) {
      throw new Error('Session release catalog exceeds size limit')
    }
    const chunks: Buffer[] = []
    let size = 0
    for await (const value of stream) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
      size += chunk.length
      if (size > MAX_CATALOG_BYTES) throw new Error('Session release catalog exceeds size limit')
      chunks.push(chunk)
    }
    return Buffer.concat(chunks, size)
  })()
  try {
    return await Promise.race([reading, deadline])
  } finally {
    clearTimeout(timer)
    stream?.destroy()
  }
}

/** Loads one deployment's immutable catalog before any sessions can be created. */
@singleton()
export class SessionReleaseCatalog {
  private readonly objectKey: string | undefined
  private readonly environment: ReleaseEnvironment | undefined
  private readonly sha256: string | undefined
  private initialization?: Promise<void>
  private catalog?: SessionReleaseCatalogSnapshot
  private keys: readonly SessionReleaseKey[] = EMPTY_KEYS

  constructor() {
    if (process.env.SB_RP2_EVIDENCE_KEYS !== undefined) {
      throw new Error('Replace SB_RP2_EVIDENCE_KEYS with SB_RP2_RELEASE_CATALOG')
    }
    this.objectKey = process.env.SB_RP2_RELEASE_CATALOG
    if (this.objectKey === undefined) return
    if (
      !this.objectKey ||
      this.objectKey.length > 1024 ||
      /[\\:%]/.test(this.objectKey) ||
      [...this.objectKey].some(char => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127) ||
      this.objectKey.split('/').some(part => !part || part === '.' || part === '..')
    ) {
      throw new Error('SB_RP2_RELEASE_CATALOG must be a storage object key')
    }
    const environment = process.env.SB_RP2_RELEASE_ENVIRONMENT
    if (environment !== 'dev' && environment !== 'staging' && environment !== 'production') {
      throw new Error('SB_RP2_RELEASE_ENVIRONMENT must be dev, staging, or production')
    }
    this.environment = environment
    const sha256 = process.env.SB_RP2_RELEASE_CATALOG_SHA256
    if (sha256 !== undefined && !HEX_32.test(sha256)) {
      throw new Error('SB_RP2_RELEASE_CATALOG_SHA256 must be a SHA-256 hex digest')
    }
    this.sha256 = sha256?.toLowerCase()
  }

  initialize(): Promise<void> {
    this.initialization ??= this.load()
    return this.initialization
  }

  private async load(): Promise<void> {
    if (this.objectKey === undefined) return
    const bytes = await readCatalog(this.objectKey)
    if (this.sha256 && createHash('sha256').update(bytes).digest('hex') !== this.sha256) {
      throw new Error('Session release catalog SHA-256 does not match')
    }
    const catalog = parseCatalog(bytes, this.environment!)
    this.keys = Object.freeze(
      catalog.releases.flatMap(release =>
        release.artifacts.map(({ keyId, publicKey }) => Object.freeze({ keyId, publicKey })),
      ),
    )
    this.catalog = catalog
  }

  getCatalog(): SessionReleaseCatalogSnapshot | undefined {
    if (this.objectKey !== undefined && !this.catalog) {
      throw new Error('Session release catalog has not been initialized')
    }
    return this.catalog
  }

  getKeys(): readonly SessionReleaseKey[] {
    this.getCatalog()
    return this.keys
  }

  getClientKeys(): readonly SessionReleaseKey[] {
    return this.getCatalog()?.clientKeys ?? EMPTY_KEYS
  }
}
