import { describe, expect, test } from 'vitest'
import {
  canReplaceCachedCatalog,
  isCachedCatalogUsable,
  openCatalogDocument,
  PRODUCTION_CATALOG_URL,
  resolveCatalogUrl,
  STAGING_CATALOG_URL,
  validateCatalogDocument,
} from './catalog'

const CATALOG_URL = 'https://cdn.example.test/catalog.json'

const DIGEST = 'a'.repeat(64)
const OTHER_DIGEST = 'b'.repeat(64)

function makePackage(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    botId: 'zzzkbot',
    releaseId: 'v1',
    version: '1.0',
    platform: { os: 'windows', architecture: 'x86' },
    runtime: { kind: 'native' },
    launch: { entrypoint: 'ZZZKBot.exe', arguments: [], workingDirectory: '.' },
    profile: {
      selectableRaces: ['zerg'],
      randomRace: 'unsupported',
      formats: [{ id: 'one-v-one', support: 'verified', notes: '' }],
      mapConstraints: [],
      learning: { mode: 'persistent', notes: '' },
    },
    bwapi: { version: '4.4.0', protocol: 10003, minimumBridgeVersion: '1' },
    sources: [{ id: 'zzzkbot', repository: 'https://example.test/x.git', revision: 'abc' }],
    licenses: [{ name: 'LGPL-3.0-or-later', noticePath: 'LICENSE.txt' }],
    permissions: {
      localDistribution: { status: 'approved', evidence: 'reviewed' },
      publicCompetition: { status: 'unreviewed', evidence: '' },
    },
    writableDirectories: ['bwapi-data/write'],
    build: {
      recipeSource: { id: 'recipes', repository: 'https://example.test/r.git', revision: 'def' },
      recipePath: 'tools/bwapi/README.md',
      toolchain: 'msvc',
    },
    sourceReview: { status: 'approved', evidence: 'reviewed' },
    ...overrides,
  }
}

function makeArtifact(overrides: Record<string, unknown> = {}) {
  return {
    url: 'https://cdn.example.test/zzzkbot-v1.zip',
    sha256: DIGEST,
    sizeBytes: 1024,
    manifestSha256: OTHER_DIGEST,
    format: 'zip',
    ...overrides,
  }
}

function makeCatalog(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    revision: 3,
    bots: [
      {
        bot: {
          id: 'zzzkbot',
          name: 'ZZZKBot',
          description: 'A Zerg opponent.',
          authors: [{ name: 'Chris Coxe' }],
          homepage: 'https://example.test/',
          sourceUrl: 'https://example.test/',
          playStyleTags: ['rush'],
          humanSkill: 'uncalibrated',
          externalRatings: [],
        },
        releases: [{ package: makePackage(), artifact: makeArtifact() }],
      },
    ],
    ...overrides,
  }
}

function withPackage(overrides: Record<string, unknown>) {
  return makeCatalog({
    bots: [
      {
        ...makeCatalog().bots[0],
        releases: [{ package: makePackage(overrides), artifact: makeArtifact() }],
      },
    ],
  })
}

function withArtifact(overrides: Record<string, unknown>) {
  return makeCatalog({
    bots: [
      {
        ...makeCatalog().bots[0],
        releases: [{ package: makePackage(), artifact: makeArtifact(overrides) }],
      },
    ],
  })
}

describe('app/bots/catalog/resolveCatalogUrl', () => {
  test('uses the channel default with no override', () => {
    expect(resolveCatalogUrl({ isDev: true })).toBe(STAGING_CATALOG_URL)
    expect(resolveCatalogUrl({ isDev: false })).toBe(PRODUCTION_CATALOG_URL)
  })

  test('accepts an https override', () => {
    expect(resolveCatalogUrl({ isDev: false, override: 'https://example.test/c.json' })).toBe(
      'https://example.test/c.json',
    )
  })

  test('accepts a plaintext override only for this machine', () => {
    expect(resolveCatalogUrl({ isDev: true, override: 'http://localhost:8080/c.json' })).toBe(
      'http://localhost:8080/c.json',
    )
    expect(resolveCatalogUrl({ isDev: true, override: 'http://127.0.0.1:8080/c.json' })).toBe(
      'http://127.0.0.1:8080/c.json',
    )
    expect(resolveCatalogUrl({ isDev: true, override: 'http://evil.example/c.json' })).toBe(
      STAGING_CATALOG_URL,
    )
  })

  test('falls back when the override is not a URL', () => {
    expect(resolveCatalogUrl({ isDev: true, override: 'not a url' })).toBe(STAGING_CATALOG_URL)
  })
})

describe('app/bots/catalog/validateCatalogDocument', () => {
  test('accepts a well-formed catalog', () => {
    const catalog = validateCatalogDocument(makeCatalog(), { catalogUrl: CATALOG_URL })
    expect(catalog.revision).toBe(3)
    expect(catalog.bots).toHaveLength(1)
    expect(catalog.bots[0].releases[0].package.launch.entrypoint).toBe('ZZZKBot.exe')
  })

  test('preserves optional Java JVM arguments', () => {
    const catalog = validateCatalogDocument(
      withPackage({
        runtime: {
          kind: 'java',
          major: 21,
          architecture: 'x86_64',
          jvmArguments: ['-Xms128m', '-Xmx1024m'],
        },
      }),
      { catalogUrl: CATALOG_URL },
    )

    expect(catalog.bots[0].releases[0].package.runtime).toEqual({
      kind: 'java',
      major: 21,
      architecture: 'x86_64',
      jvmArguments: ['-Xms128m', '-Xmx1024m'],
    })
  })

  test.each([
    ['an unsupported schema version', makeCatalog({ schemaVersion: 2 })],
    ['a non-integer revision', makeCatalog({ revision: 1.5 })],
    ['a missing bots array', makeCatalog({ bots: undefined })],
    [
      'an invalid bot ID',
      makeCatalog({
        bots: [
          { ...makeCatalog().bots[0], bot: { ...makeCatalog().bots[0].bot, id: 'Not Valid' } },
        ],
      }),
    ],
    ['an empty release list', makeCatalog({ bots: [{ ...makeCatalog().bots[0], releases: [] }] })],
    ['a package for a different bot', withPackage({ botId: 'other' })],
    ['an unsupported package schema version', withPackage({ schemaVersion: 2 })],
    [
      'no selectable races',
      withPackage({
        profile: { ...makePackage().profile, selectableRaces: [] },
      }),
    ],
    ['an unknown runtime', withPackage({ runtime: { kind: 'python' } })],
    [
      'Java JVM arguments that are not text',
      withPackage({
        runtime: { kind: 'java', major: 21, architecture: 'x86_64', jvmArguments: ['-Xmx1g', 1] },
      }),
    ],
    [
      'a Java runtime with no major version',
      withPackage({
        runtime: { kind: 'java', architecture: 'x86' },
      }),
    ],
    [
      'an entrypoint that escapes the package',
      withPackage({
        launch: { entrypoint: '../evil.exe', arguments: [], workingDirectory: '.' },
      }),
    ],
    [
      'a writable directory that escapes the package',
      withPackage({
        writableDirectories: ['../elsewhere'],
      }),
    ],
    ['a plaintext artifact URL', withArtifact({ url: 'http://cdn.example.test/x.zip' })],
    ['a malformed digest', withArtifact({ sha256: 'nope' })],
    ['a zero size', withArtifact({ sizeBytes: 0 })],
    ['an unsupported archive format', withArtifact({ format: 'tar' })],
  ])('rejects %s', (_description, document) => {
    expect(() => validateCatalogDocument(document, { catalogUrl: CATALOG_URL })).toThrow()
  })

  test('rejects a bot listed twice', () => {
    const duplicate = makeCatalog({ bots: [makeCatalog().bots[0], makeCatalog().bots[0]] })
    expect(() => validateCatalogDocument(duplicate, { catalogUrl: CATALOG_URL })).toThrow(
      /more than once/,
    )
  })

  test('allows a plaintext artifact served by a local development catalog', () => {
    const local = withArtifact({ url: 'http://localhost:8080/zzzkbot-v1.zip' })
    expect(() =>
      validateCatalogDocument(local, { catalogUrl: 'http://localhost:8080/catalog.json' }),
    ).not.toThrow()
    expect(() =>
      validateCatalogDocument(local, { catalogUrl: 'http://localhost:9090/catalog.json' }),
    ).toThrow()
  })
})

describe('app/bots/catalog/openCatalogDocument', () => {
  const trust = { channel: 'staging' as const, keyId: 'k', publicKey: '' }

  test('refuses a bare catalog unless it came from this machine', () => {
    expect(() => openCatalogDocument(makeCatalog(), { url: CATALOG_URL, trust })).toThrow(
      /not signed/,
    )
    expect(
      openCatalogDocument(makeCatalog(), { url: 'http://localhost:8080/catalog.json', trust })
        .revision,
    ).toBe(3)
  })
})

describe('app/bots/catalog/cache rules', () => {
  const cached = { url: CATALOG_URL, revision: 5 }

  test('only uses a cache from the same URL', () => {
    expect(isCachedCatalogUsable(cached, CATALOG_URL)).toBe(true)
    expect(isCachedCatalogUsable(cached, 'https://other.example.test/catalog.json')).toBe(false)
    expect(isCachedCatalogUsable(undefined, CATALOG_URL)).toBe(false)
  })

  test('refuses a revision older than the cached one', () => {
    expect(canReplaceCachedCatalog(cached, CATALOG_URL, 6)).toBe(true)
    expect(canReplaceCachedCatalog(cached, CATALOG_URL, 5)).toBe(true)
    expect(canReplaceCachedCatalog(cached, CATALOG_URL, 4)).toBe(false)
  })

  test('replaces a cache from a different URL whatever its revision', () => {
    expect(canReplaceCachedCatalog(cached, 'https://other.example.test/catalog.json', 1)).toBe(true)
    expect(canReplaceCachedCatalog(undefined, CATALOG_URL, 0)).toBe(true)
  })
})
