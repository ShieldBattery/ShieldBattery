import { describe, expect, test } from 'vitest'
import { GameType } from '../games/game-type'
import { BotCatalogEntry, BotIdentity, BotPackage } from './bot-catalog'
import { BotLibrarySnapshot, InstalledBotRelease, LocalBuildBot } from './bot-library'
import { botFormatCompatibility, buildBotViews } from './bot-view'

function makeIdentity(id: string): BotIdentity {
  return {
    id,
    name: id.toUpperCase(),
    description: 'desc',
    authors: [{ name: 'Author' }],
    homepage: 'https://example.com',
    sourceUrl: 'https://example.com/src',
    playStyleTags: ['macro'],
    humanSkill: 'uncalibrated',
    externalRatings: [],
  }
}

function makePackage(botId: string, releaseId: string, runtime: BotPackage['runtime']): BotPackage {
  return {
    schemaVersion: 1,
    botId,
    releaseId,
    version: releaseId,
    platform: { os: 'windows', architecture: 'x86' },
    runtime,
    launch: { entrypoint: 'bot.exe', arguments: [], workingDirectory: '.' },
    profile: {
      selectableRaces: ['zerg', 'terran'],
      randomRace: 'unsupported',
      formats: [{ id: 'one-v-one', support: 'verified', notes: 'ok' }],
      mapConstraints: [],
      learning: { mode: 'persistent', notes: 'learns' },
    },
    bwapi: { version: '4.4.0', protocol: 10003, minimumBridgeVersion: '1' },
    sources: [{ id: botId, repository: 'https://example.com/repo.git', revision: 'a'.repeat(40) }],
    licenses: [{ name: 'MIT', noticePath: 'LICENSE' }],
    permissions: {
      localDistribution: { status: 'approved', evidence: 'yes' },
      publicCompetition: { status: 'unreviewed', evidence: 'no' },
    },
    writableDirectories: ['bwapi-data/write'],
    build: {
      recipeSource: {
        id: 'recipe',
        repository: 'https://example.com/r.git',
        revision: 'b'.repeat(40),
      },
      recipePath: 'recipe.cmake',
      toolchain: 'msvc',
    },
    sourceReview: { status: 'approved', evidence: 'reviewed' },
  }
}

function makeEntry(id: string, releaseIds: string[]): BotCatalogEntry {
  return {
    bot: makeIdentity(id),
    releases: releaseIds.map(releaseId => ({
      package: makePackage(id, releaseId, { kind: 'native' }),
      artifact: {
        url: `https://cdn.example.com/${id}-${releaseId}.zip`,
        sha256: 'c'.repeat(64),
        sizeBytes: 48 * 1024 * 1024,
        manifestSha256: 'd'.repeat(64),
        format: 'zip',
      },
    })),
  }
}

function makeInstalled(
  id: string,
  releaseId: string,
  runtime: BotPackage['runtime'] = { kind: 'native' },
): InstalledBotRelease {
  return {
    botId: id,
    releaseId,
    version: releaseId,
    installedAt: 1,
    sizeBytes: 10,
    digest: 'e'.repeat(64),
    bot: makeIdentity(id),
    package: makePackage(id, releaseId, runtime),
  }
}

function makeSnapshot(overrides: Partial<BotLibrarySnapshot> = {}): BotLibrarySnapshot {
  return {
    catalogStatus: { refreshing: false },
    installed: [],
    localBuilds: [],
    installs: [],
    installFailures: [],
    java: { detected: [], added: [], overrides: {} },
    inUse: [],
    hasLearningData: [],
    ...overrides,
  }
}

describe('buildBotViews', () => {
  test('a catalog-only bot is not installed and downloadable', () => {
    const views = buildBotViews(
      makeSnapshot({
        catalog: { revision: 1, fetchedAt: 0, url: 'u', bots: [makeEntry('iron', ['r1'])] },
      }),
    )
    expect(views).toHaveLength(1)
    expect(views[0].readiness).toEqual({
      state: 'notInstalled',
      sizeBytes: 48 * 1024 * 1024,
      canDownload: true,
    })
    expect(views[0].version).toBe('r1')
  })

  test('an installed bot stays on its release and sees a newer catalog release', () => {
    const views = buildBotViews(
      makeSnapshot({
        catalog: { revision: 2, fetchedAt: 0, url: 'u', bots: [makeEntry('iron', ['r1', 'r2'])] },
        installed: [makeInstalled('iron', 'r1')],
      }),
    )
    expect(views[0].version).toBe('r1')
    expect(views[0].updateAvailable?.package.releaseId).toBe('r2')
    expect(views[0].readiness.state).toBe('ready')
  })

  test('an installed bot shows the identity from the current catalog', () => {
    const entry = makeEntry('iron', ['r1'])
    entry.bot = { ...entry.bot, playStyleTags: ['cheese', 'drops'] }
    const views = buildBotViews(
      makeSnapshot({
        catalog: { revision: 2, fetchedAt: 0, url: 'u', bots: [entry] },
        installed: [makeInstalled('iron', 'r1')],
      }),
    )
    expect(views[0].playStyleTags).toEqual(['cheese', 'drops'])
  })

  test('an installed bot removed from the catalog remains usable', () => {
    const views = buildBotViews(makeSnapshot({ installed: [makeInstalled('gone', 'r1')] }))
    expect(views).toHaveLength(1)
    expect(views[0].readiness.state).toBe('ready')
    expect(views[0].catalogEntry).toBeUndefined()
  })

  test('java bots need a matching runtime or an override', () => {
    const runtime = { kind: 'java' as const, major: 17, architecture: 'x86' as const }
    const base = makeSnapshot({ installed: [makeInstalled('purple', 'r1', runtime)] })
    expect(buildBotViews(base)[0].readiness).toEqual({ state: 'missingRuntime', runtime })

    const wrongArch = {
      ...base,
      java: {
        detected: [{ path: 'j', major: 17, architecture: 'x86_64' as const }],
        added: [],
        overrides: {},
      },
    }
    expect(buildBotViews(wrongArch)[0].readiness.state).toBe('missingRuntime')

    const detected = {
      ...base,
      java: {
        detected: [{ path: 'j', major: 17, architecture: 'x86' as const }],
        added: [],
        overrides: {},
      },
    }
    expect(buildBotViews(detected)[0].readiness.state).toBe('ready')

    const override = {
      ...base,
      java: { detected: [], added: [], overrides: { purple: 'C:\\java.exe' } },
    }
    expect(buildBotViews(override)[0].readiness.state).toBe('ready')
  })

  test('install progress and failures take precedence', () => {
    const progress = {
      botId: 'iron',
      releaseId: 'r1',
      phase: 'downloading' as const,
      receivedBytes: 1,
      totalBytes: 2,
    }
    const failure = {
      botId: 'iron',
      releaseId: 'r1',
      error: 'boom',
      receivedBytes: 1,
      totalBytes: 2,
      failedAt: 0,
    }
    const catalog = { revision: 1, fetchedAt: 0, url: 'u', bots: [makeEntry('iron', ['r1'])] }
    expect(buildBotViews(makeSnapshot({ catalog, installs: [progress] }))[0].readiness).toEqual({
      state: 'installing',
      progress,
    })
    expect(
      buildBotViews(makeSnapshot({ catalog, installFailures: [failure] }))[0].readiness,
    ).toEqual({
      state: 'installFailed',
      failure,
    })
  })

  test('local builds appear with their own key and sort with the rest', () => {
    const build: LocalBuildBot = {
      key: 'local:1',
      name: 'Aardvark',
      version: 'dev',
      executable: 'C:\\bot.exe',
      args: [],
      workingDirectory: 'C:\\',
      runtime: { kind: 'native' },
      races: ['protoss'],
      formats: [],
      learning: { mode: 'unknown', notes: '' },
      addedAt: 0,
      updatedAt: 0,
    }
    const views = buildBotViews(
      makeSnapshot({
        installed: [makeInstalled('zed', 'r1')],
        localBuilds: [build],
        inUse: ['local:1'],
      }),
    )
    expect(views.map(v => v.key)).toEqual(['local:1', 'zed'])
    expect(views[0].source).toBe('local')
    expect(views[0].inUse).toBe(true)
    expect(views[0].readiness.state).toBe('ready')
  })
})

describe('botFormatCompatibility', () => {
  const bot = {
    formats: [
      { id: 'one-v-one' as const, support: 'verified' as const, notes: 'ok' },
      { id: 'free-for-all' as const, support: 'incompatible' as const, notes: 'no' },
    ],
  }

  test('1v1 melee uses the one-v-one format', () => {
    expect(botFormatCompatibility(bot, GameType.Melee, 1).support).toBe('verified')
  })

  test('several opponents or FFA use the free-for-all format', () => {
    expect(botFormatCompatibility(bot, GameType.Melee, 2).support).toBe('incompatible')
    expect(botFormatCompatibility(bot, GameType.FreeForAll, 1).support).toBe('incompatible')
  })

  test('a missing format entry is unverified', () => {
    expect(botFormatCompatibility({ formats: [] }, GameType.Melee, 1).support).toBe('unverified')
  })
})

describe('botFormatForGame', () => {
  test('top vs bottom with several bots is a team game, alone it is a 1v1', () => {
    const bot = { formats: [{ id: 'teams' as const, support: 'verified' as const, notes: '' }] }
    expect(botFormatCompatibility(bot, GameType.TopVsBottom, 3)).toMatchObject({
      format: 'teams',
      support: 'verified',
    })
    expect(botFormatCompatibility(bot, GameType.TopVsBottom, 1).format).toBe('one-v-one')
    expect(botFormatCompatibility(bot, GameType.FreeForAll, 1).format).toBe('free-for-all')
  })
})
