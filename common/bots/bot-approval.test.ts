import { describe, expect, test } from 'vitest'
import { botLibraryForBuild } from './bot-approval'
import { BotCatalogEntry, BotCatalogRelease } from './bot-catalog'
import { BotLibrarySnapshot, InstalledBotRelease } from './bot-library'
import { buildBotViews } from './bot-view'

function release(
  id: string,
  releaseStatus?: BotCatalogRelease['releaseStatus'],
): BotCatalogRelease {
  return {
    releaseStatus,
    package: {
      releaseId: id,
      version: id,
      runtime: { kind: 'native' },
      profile: { selectableRaces: ['zerg'], formats: [], learning: { mode: 'none', notes: '' } },
    },
    artifact: { sha256: id },
  } as unknown as BotCatalogRelease
}

function snapshot(): BotLibrarySnapshot {
  const releases = [release('approved', 'production-approved'), release('next', 'staging')]
  const bot = { id: 'bot', name: 'Bot', humanSkill: 'uncalibrated' }
  return {
    catalog: {
      url: 'https://example.test/catalog.json',
      revision: 1,
      fetchedAt: 0,
      bots: [
        { bot, releases },
        { bot: { ...bot, id: 'candidate' }, releases: [release('candidate')] },
      ] as BotCatalogEntry[],
    },
    catalogStatus: { refreshing: false },
    installed: [
      {
        botId: 'bot',
        releaseId: 'approved',
        digest: 'approved',
        bot,
        package: releases[0].package,
      },
    ] as InstalledBotRelease[],
    localBuilds: [{ key: 'local:test' }] as BotLibrarySnapshot['localBuilds'],
    installs: [],
    installFailures: [],
    java: { detected: [], added: [], overrides: {} },
    inUse: [],
    hasLearningData: [],
  }
}

describe('bot production approval', () => {
  test('production keeps approved releases, hides candidates and local builds, and offers no candidate update', () => {
    const source = snapshot()
    const filtered = botLibraryForBuild(source, false)
    expect(filtered.catalog?.bots).toHaveLength(1)
    expect(filtered.catalog?.bots[0].releases.map(r => r.package.releaseId)).toEqual(['approved'])
    expect(filtered.localBuilds).toEqual([])
    expect(filtered.installed).toHaveLength(1)
    expect(buildBotViews(filtered)[0].updateAvailable).toBeUndefined()
    expect(buildBotViews(filtered)[0].releaseStatus).toBe('production-approved')
    expect(source.catalog?.bots[0].releases).toHaveLength(2)
  })

  test.each(['next', 'removed', 'wrong-digest'])(
    'previous installation cannot grant approval: %s',
    id => {
      const source = snapshot()
      source.installed[0] = {
        ...source.installed[0],
        releaseId: id === 'wrong-digest' ? 'approved' : id,
        digest: id,
      }
      expect(botLibraryForBuild(source, false).installed).toEqual([])
    },
  )

  test('no current catalog fails closed even with previously installed bots', () => {
    const source = snapshot()
    source.catalog = undefined
    expect(botLibraryForBuild(source, false).installed).toEqual([])
  })

  test('dev preserves all candidates, older installations and local builds', () => {
    const source = snapshot()
    expect(botLibraryForBuild(source, true)).toBe(source)
    source.localBuilds = []
    const views = buildBotViews(source)
    expect(views.find(v => v.key === 'candidate')?.releaseStatus).toBe('candidate')
    expect(views.find(v => v.key === 'bot')?.updateAvailable?.releaseStatus).toBe('staging')
  })
})
