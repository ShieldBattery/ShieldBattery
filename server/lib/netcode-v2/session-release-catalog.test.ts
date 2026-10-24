import { createHash } from 'node:crypto'
import { PassThrough, Readable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { asMockedFunction } from '../../../common/testing/mocks'
import { readFileStream } from '../files'
import { StoredFileStream } from '../files/store'
import { SessionReleaseCatalog } from './session-release-catalog'

vi.mock('../files', () => ({ readFileStream: vi.fn() }))

function fixture() {
  return {
    format: 1,
    environment: 'production',
    kind: 'game',
    releases: [
      {
        version: '12.3.1',
        artifacts: ['x86', 'x64'].map((arch, i) => ({
          arch,
          keyId: i + 1,
          publicKey: (i + 10).toString(16).repeat(64),
          sha256: 'cd'.repeat(32),
          metadata: Buffer.from('opaque release metadata').toString('base64'),
        })),
      },
    ],
  }
}

function configure() {
  vi.stubEnv('SB_RP2_RELEASE_CATALOG', 'releases/12.3.1/catalog.json')
  vi.stubEnv('SB_RP2_RELEASE_ENVIRONMENT', 'production')
}

function serve(value: unknown = fixture(), size?: number): Readable {
  const stream = Readable.from([Buffer.from(JSON.stringify(value))])
  asMockedFunction(readFileStream).mockResolvedValue({ stream, size })
  return stream
}

beforeEach(() => {
  vi.resetAllMocks()
  for (const key of [
    'SB_RP2_EVIDENCE_KEYS',
    'SB_RP2_RELEASE_CATALOG',
    'SB_RP2_RELEASE_ENVIRONMENT',
    'SB_RP2_RELEASE_CATALOG_SHA256',
  ]) {
    vi.stubEnv(key, undefined)
  }
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

test('disabled catalog needs no storage and exposes no keys', async () => {
  const catalog = new SessionReleaseCatalog()
  expect(catalog.getKeys()).toEqual([])
  expect(catalog.getClientKeys()).toEqual([])
  expect(Object.isFrozen(catalog.getClientKeys())).toBe(true)
  expect(catalog.getCatalog()).toBeUndefined()
  await catalog.initialize()
  expect(readFileStream).not.toHaveBeenCalled()
})

test('configured catalog rejects use before initialization', () => {
  configure()
  const catalog = new SessionReleaseCatalog()
  expect(() => catalog.getKeys()).toThrow('has not been initialized')
  expect(() => catalog.getClientKeys()).toThrow('has not been initialized')
  expect(() => catalog.getCatalog()).toThrow('has not been initialized')
  expect(readFileStream).not.toHaveBeenCalled()
})

test('initialization coalesces, validates its pin, and exposes a deeply frozen snapshot', async () => {
  configure()
  const value = fixture()
  value.releases[0].artifacts[0].publicKey = 'AB'.repeat(32)
  vi.stubEnv(
    'SB_RP2_RELEASE_CATALOG_SHA256',
    createHash('sha256').update(JSON.stringify(value)).digest('hex').toUpperCase(),
  )
  serve(value)
  const catalog = new SessionReleaseCatalog()
  const first = catalog.initialize()
  expect(catalog.initialize()).toBe(first)
  await first
  expect(catalog.initialize()).toBe(first)
  expect(readFileStream).toHaveBeenCalledExactlyOnceWith('releases/12.3.1/catalog.json')
  const snapshot = catalog.getCatalog()!
  expect(catalog.getCatalog()).toBe(snapshot)
  expect(Object.isFrozen(snapshot)).toBe(true)
  expect(Object.isFrozen(snapshot.releases)).toBe(true)
  expect(Object.isFrozen(snapshot.releases[0])).toBe(true)
  expect(Object.isFrozen(snapshot.releases[0].artifacts)).toBe(true)
  expect(Object.isFrozen(snapshot.releases[0].artifacts[0])).toBe(true)
  const keys = catalog.getKeys()
  expect(keys).toEqual([
    { keyId: 1, publicKey: 'ab'.repeat(32) },
    { keyId: 2, publicKey: 'b'.repeat(64) },
  ])
  expect(catalog.getKeys()).toBe(keys)
  expect(Object.isFrozen(keys)).toBe(true)
  expect(Object.isFrozen(keys[0])).toBe(true)
  expect(catalog.getClientKeys()).toEqual([])
  expect(Object.isFrozen(catalog.getClientKeys())).toBe(true)
})

test('client keys remain separate from game keys and are deeply frozen', async () => {
  configure()
  const value = {
    ...fixture(),
    clientKeys: [
      { keyId: 0, publicKey: 'CD'.repeat(32) },
      { keyId: 0xffffffff, publicKey: 'EF'.repeat(32) },
    ],
  }
  serve(value)
  const catalog = new SessionReleaseCatalog()
  await catalog.initialize()
  expect(catalog.getClientKeys()).toEqual([
    { keyId: 0, publicKey: 'cd'.repeat(32) },
    { keyId: 0xffffffff, publicKey: 'ef'.repeat(32) },
  ])
  expect(catalog.getKeys().map(key => key.keyId)).toEqual([1, 2])
  expect(catalog.getCatalog()!.clientKeys).toBe(catalog.getClientKeys())
  expect(Object.isFrozen(catalog.getClientKeys())).toBe(true)
  expect(catalog.getClientKeys().every(Object.isFrozen)).toBe(true)
})

describe('client key validation', () => {
  const key = { keyId: 3, publicKey: 'cd'.repeat(32) }
  test.each<[string, unknown]>([
    ['null keys', null],
    ['non-array keys', key],
    ['empty keys', []],
    [
      'too many keys',
      Array.from({ length: 9 }, (_, i) => ({
        keyId: i + 3,
        publicKey: (i + 16).toString(16).repeat(32),
      })),
    ],
    ['missing fields', [{}]],
    ['null entry', [null]],
    ['array entry', [[3, key.publicKey]]],
    ['unknown field', [{ ...key, purpose: 'signup' }]],
    ['negative key ID', [{ ...key, keyId: -1 }]],
    ['overflow key ID', [{ ...key, keyId: 0x100000000 }]],
    ['fractional key ID', [{ ...key, keyId: 1.5 }]],
    ['string key ID', [{ ...key, keyId: '3' }]],
    ['invalid public key', [{ ...key, publicKey: 'xx'.repeat(32) }]],
    ['short public key', [{ ...key, publicKey: 'cd'.repeat(31) }]],
    ['duplicate client key ID', [key, { ...key, publicKey: 'ef'.repeat(32) }]],
    ['duplicate client public key', [key, { keyId: 4, publicKey: key.publicKey.toUpperCase() }]],
    ['game key ID reuse', [{ ...key, keyId: 1 }]],
    [
      'game public key reuse',
      [{ ...key, publicKey: fixture().releases[0].artifacts[0].publicKey.toUpperCase() }],
    ],
  ])('rejects %s without enabling either key purpose', async (_name, clientKeys) => {
    configure()
    serve({ ...fixture(), clientKeys })
    const catalog = new SessionReleaseCatalog()
    await expect(catalog.initialize()).rejects.toThrow('Invalid session release catalog')
    expect(() => catalog.getClientKeys()).toThrow('has not been initialized')
    expect(() => catalog.getKeys()).toThrow('has not been initialized')
  })
})

test('all catalog releases contribute their exact keys', async () => {
  configure()
  const value = fixture()
  value.releases.push({
    version: '12.3.2',
    artifacts: value.releases[0].artifacts.map((artifact, i) => ({
      ...artifact,
      keyId: 100 + i,
      publicKey: (i + 12).toString(16).repeat(64),
    })),
  })
  serve(value)
  const catalog = new SessionReleaseCatalog()
  await catalog.initialize()
  expect(catalog.getKeys()).toEqual(
    value.releases.flatMap(release =>
      release.artifacts.map(({ keyId, publicKey }) => ({ keyId, publicKey })),
    ),
  )
})

test.each(['keyId', 'publicKey'] as const)('rejects %s reuse across releases', async field => {
  configure()
  const value = fixture()
  const second = {
    version: '12.3.2',
    artifacts: value.releases[0].artifacts.map((artifact, i) => ({
      ...artifact,
      keyId: 100 + i,
      publicKey: (i + 12).toString(16).repeat(64),
    })),
  }
  if (field === 'keyId') second.artifacts[0].keyId = value.releases[0].artifacts[0].keyId
  else second.artifacts[0].publicKey = value.releases[0].artifacts[0].publicKey.toUpperCase()
  value.releases.push(second)
  serve(value)
  await expect(new SessionReleaseCatalog().initialize()).rejects.toThrow(
    'Invalid session release catalog',
  )
})

test.each([
  '',
  '/catalog.json',
  'https://store/catalog.json',
  'C:\\catalog.json',
  '../catalog.json',
  'releases/../catalog.json',
  'releases/./catalog.json',
  'releases//catalog.json',
  'releases/%2e%2e/catalog.json',
  'releases/\ncatalog.json',
])('rejects invalid storage key %j without making a request', key => {
  configure()
  vi.stubEnv('SB_RP2_RELEASE_CATALOG', key)
  expect(() => new SessionReleaseCatalog()).toThrow('storage object key')
  expect(readFileStream).not.toHaveBeenCalled()
})

test('legacy keys require migration without including their value in the error', () => {
  vi.stubEnv('SB_RP2_EVIDENCE_KEYS', 'sensitive legacy configuration')
  expect(() => new SessionReleaseCatalog()).toThrow(
    'Replace SB_RP2_EVIDENCE_KEYS with SB_RP2_RELEASE_CATALOG',
  )
})

test('requires an explicit environment and a well-formed optional pin', () => {
  configure()
  vi.stubEnv('SB_RP2_RELEASE_ENVIRONMENT', undefined)
  expect(() => new SessionReleaseCatalog()).toThrow('SB_RP2_RELEASE_ENVIRONMENT')
  configure()
  vi.stubEnv('SB_RP2_RELEASE_CATALOG_SHA256', 'bad')
  expect(() => new SessionReleaseCatalog()).toThrow('SB_RP2_RELEASE_CATALOG_SHA256')
})

describe('catalog validation', () => {
  const mutations: Array<[string, (value: ReturnType<typeof fixture>) => void]> = [
    ['wrong format', value => (value.format = 2)],
    ['wrong environment', value => (value.environment = 'staging')],
    ['practice release', value => (value.kind = 'practice')],
    ['unknown root field', value => Object.assign(value, { unexpected: true })],
    ['unknown release field', value => Object.assign(value.releases[0], { unexpected: true })],
    [
      'unknown artifact field',
      value => Object.assign(value.releases[0].artifacts[0], { seed: 'x' }),
    ],
    ['empty releases', value => (value.releases = [])],
    ['too many releases', value => (value.releases = Array(9).fill(value.releases[0]))],
    ['duplicate version', value => value.releases.push(structuredClone(value.releases[0]))],
    ['empty version', value => (value.releases[0].version = '')],
    ['long version', value => (value.releases[0].version = 'x'.repeat(129))],
    ['missing architecture', value => value.releases[0].artifacts.pop()],
    ['duplicate architecture', value => (value.releases[0].artifacts[1].arch = 'x86')],
    ['unknown architecture', value => (value.releases[0].artifacts[0].arch = 'arm64')],
    ['duplicate key id', value => (value.releases[0].artifacts[1].keyId = 1)],
    ['negative key id', value => (value.releases[0].artifacts[0].keyId = -1)],
    ['overflow key id', value => (value.releases[0].artifacts[0].keyId = 0x100000000)],
    ['fractional key id', value => (value.releases[0].artifacts[0].keyId = 1.5)],
    ['duplicate public key', value => (value.releases[0].artifacts[1].publicKey = 'A'.repeat(64))],
    ['invalid public key', value => (value.releases[0].artifacts[0].publicKey = 'x'.repeat(64))],
    ['invalid artifact hash', value => (value.releases[0].artifacts[0].sha256 = 'ab')],
    ['invalid base64', value => (value.releases[0].artifacts[0].metadata = '!!!!')],
    ['noncanonical base64', value => (value.releases[0].artifacts[0].metadata = 'YR==')],
    ['unpadded base64', value => (value.releases[0].artifacts[0].metadata = 'YQ')],
    [
      'oversized metadata',
      value =>
        (value.releases[0].artifacts[0].metadata = Buffer.alloc(32 * 1024 + 1).toString('base64')),
    ],
  ]
  test.each(mutations)('rejects %s permanently', async (name, mutate) => {
    configure()
    const value = fixture()
    mutate(value)
    serve(value)
    const catalog = new SessionReleaseCatalog()
    const initialization = catalog.initialize()
    await expect(initialization).rejects.toThrow('Invalid session release catalog')
    expect(catalog.initialize()).toBe(initialization)
    expect(() => catalog.getKeys()).toThrow('has not been initialized')
    expect(readFileStream).toHaveBeenCalledTimes(1)
  })
})

test('rejects a pin mismatch', async () => {
  configure()
  vi.stubEnv('SB_RP2_RELEASE_CATALOG_SHA256', '00'.repeat(32))
  serve()
  await expect(new SessionReleaseCatalog().initialize()).rejects.toThrow('SHA-256 does not match')
})

test.each([undefined, 1, 512 * 1024 + 1])('bounds bytes with advertised size %s', async size => {
  configure()
  const stream = Readable.from([Buffer.alloc(256 * 1024), Buffer.alloc(256 * 1024 + 1)])
  asMockedFunction(readFileStream).mockResolvedValue({ stream, size })
  await expect(new SessionReleaseCatalog().initialize()).rejects.toThrow('exceeds size limit')
  expect(stream.destroyed).toBe(true)
})

test('destroys a stream that fails during a read', async () => {
  configure()
  const stream = new PassThrough()
  asMockedFunction(readFileStream).mockResolvedValue({ stream })
  const initialization = new SessionReleaseCatalog().initialize()
  queueMicrotask(() => stream.destroy(new Error('storage failed')))
  await expect(initialization).rejects.toThrow('storage failed')
  expect(stream.destroyed).toBe(true)
})

test('one deadline covers both opening and reading', async () => {
  configure()
  vi.useFakeTimers()
  const stream = new PassThrough()
  asMockedFunction(readFileStream).mockImplementation(
    () => new Promise(resolve => setTimeout(() => resolve({ stream }), 6000)),
  )
  const catalog = new SessionReleaseCatalog()
  await Promise.all([
    expect(catalog.initialize()).rejects.toThrow('timed out'),
    (async () => {
      await vi.advanceTimersByTimeAsync(9999)
      expect(stream.destroyed).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
    })(),
  ])
  expect(stream.destroyed).toBe(true)
  expect(() => catalog.getKeys()).toThrow('has not been initialized')
})

test('closes a late stream and never accepts it after startup timed out', async () => {
  configure()
  vi.useFakeTimers()
  let finishOpen!: (opened: StoredFileStream) => void
  asMockedFunction(readFileStream).mockImplementation(
    () => new Promise(resolve => (finishOpen = resolve)),
  )
  const catalog = new SessionReleaseCatalog()
  const initialization = catalog.initialize()
  await Promise.all([
    expect(initialization).rejects.toThrow('timed out'),
    vi.advanceTimersByTimeAsync(10_000),
  ])
  const stream = Readable.from([Buffer.from(JSON.stringify(fixture()))])
  finishOpen({ stream })
  await vi.advanceTimersByTimeAsync(0)
  expect(stream.destroyed).toBe(true)
  expect(catalog.initialize()).toBe(initialization)
  expect(() => catalog.getKeys()).toThrow('has not been initialized')
})
