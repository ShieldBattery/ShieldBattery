import { describe, expect, test } from 'vitest'
import { MapInfoJson, SbMapId } from '../maps'
import { makeSbUserId } from '../users/sb-user-id'
import { BotHumanSkillEstimate } from './bot-catalog'
import { BotReadiness, BotView } from './bot-view'
import {
  computePoolReadiness,
  drawMatchup,
  hasAnyCalibratedBot,
  localDayKey,
  pickDailyItem,
  recommendBots,
} from './practice-logic'

function makeMap(id: string, slots = 4): MapInfoJson {
  return {
    id: id as SbMapId,
    hash: `hash-${id}`,
    name: id,
    description: '',
    uploadedBy: makeSbUserId(1),
    uploadDate: 0,
    visibility: 'OFFICIAL',
    imageVersion: 1,
    mapData: {
      format: 'scx',
      tileset: 0,
      originalName: id,
      originalDescription: '',
      slots,
      umsSlots: slots,
      umsForces: [],
      width: 128,
      height: 128,
      isEud: false,
      parserVersion: 2,
    },
  } as MapInfoJson
}

function makeBot(
  key: string,
  overrides: Partial<BotView> & { readiness?: BotReadiness } = {},
): BotView {
  return {
    key,
    source: 'catalog',
    name: key,
    version: '1.0',
    description: '',
    authors: [],
    playStyleTags: [],
    races: ['zerg'],
    randomRace: 'unsupported',
    formats: [{ id: 'one-v-one', support: 'verified', notes: '' }],
    mapConstraints: [],
    learning: { mode: 'none', notes: '' },
    runtime: { kind: 'native' },
    strength: [{ race: 'zerg', estimate: undefined }],
    readiness: { state: 'ready' },
    modifications: [],
    inUse: false,
    hasLearningData: false,
    ...overrides,
  }
}

const mapA = makeMap('a')
const mapB = makeMap('b')
const knownMaps = { [mapA.id]: mapA, [mapB.id]: mapB }

describe('computePoolReadiness', () => {
  test('separates installed, missing and unknown maps', () => {
    const readiness = computePoolReadiness({
      lineup: [],
      bots: [],
      poolMapIds: [mapA.id, mapB.id, 'c' as SbMapId],
      knownMaps,
      installedMapHashes: new Set([mapA.hash]),
    })
    expect(readiness.installedMaps).toEqual([mapA])
    expect(readiness.missingMaps).toEqual([mapB])
    expect(readiness.unknownMapIds).toEqual(['c'])
    expect(readiness.canDraw).toBe(false)
  })

  test('only ready bots with an installed map are playable', () => {
    const ready = makeBot('ready')
    const needsJava = makeBot('java', {
      readiness: {
        state: 'missingRuntime',
        runtime: { kind: 'java', major: 17, architecture: 'x86' },
      },
    })
    const readiness = computePoolReadiness({
      lineup: [
        { key: 'ready', name: 'ready', version: '1.0' },
        { key: 'java', name: 'java', version: '1.0' },
        { key: 'gone', name: 'gone', version: '1.0' },
      ],
      bots: [ready, needsJava],
      poolMapIds: [mapA.id, mapB.id],
      knownMaps,
      installedMapHashes: new Set([mapA.hash]),
    })
    expect(readiness.entries.map(e => e.playable)).toEqual([true, false, false])
    expect(readiness.entries[0].playableMapIds).toEqual([mapA.id])
    expect(readiness.entries[2].bot).toBeUndefined()
    expect(readiness.canDraw).toBe(true)
  })

  test('a known-incompatible 1v1 format is never playable', () => {
    const bot = makeBot('bad', {
      formats: [{ id: 'one-v-one', support: 'incompatible', notes: 'crashes' }],
    })
    const readiness = computePoolReadiness({
      lineup: [{ key: 'bad', name: 'bad', version: '1.0' }],
      bots: [bot],
      poolMapIds: [mapA.id],
      knownMaps,
      installedMapHashes: new Set([mapA.hash]),
    })
    expect(readiness.canDraw).toBe(false)
  })
})

describe('drawMatchup', () => {
  const bots = [makeBot('x', { races: ['zerg', 'terran'] }), makeBot('y')]
  const readiness = computePoolReadiness({
    lineup: bots.map(b => ({ key: b.key, name: b.name, version: '1.0' })),
    bots,
    poolMapIds: [mapA.id, mapB.id],
    knownMaps,
    installedMapHashes: new Set([mapA.hash, mapB.hash]),
  })

  test('returns nothing for an empty pool', () => {
    const empty = computePoolReadiness({
      lineup: [],
      bots,
      poolMapIds: [],
      knownMaps,
      installedMapHashes: new Set(),
    })
    expect(drawMatchup(empty, undefined)).toBeUndefined()
  })

  test('avoids the previous opponent when another is available', () => {
    for (let i = 0; i < 20; i++) {
      expect(drawMatchup(readiness, 'x', Math.random)!.bot.key).toBe('y')
    }
  })

  test('repeats the only playable opponent', () => {
    const single = computePoolReadiness({
      lineup: [{ key: 'x', name: 'x', version: '1.0' }],
      bots,
      poolMapIds: [mapA.id],
      knownMaps,
      installedMapHashes: new Set([mapA.hash]),
    })
    expect(drawMatchup(single, 'x')!.bot.key).toBe('x')
  })

  test('picks a race the bot supports and a map it can play', () => {
    const draw = drawMatchup(readiness, undefined, () => 0.99)!
    expect(draw.bot.races).toContain(draw.race)
    expect([mapA.id, mapB.id]).toContain(draw.mapId)
  })
})

describe('recommendBots', () => {
  const estimate = (
    race: BotHumanSkillEstimate['race'],
    rating: number,
    state: BotHumanSkillEstimate['state'] = 'calibrated',
  ) => ({
    race,
    estimate: { race, rating, state, measuredOn: '2026-09-01' },
  })
  const bots = [
    makeBot('even', { strength: [estimate('zerg', 1550)] }),
    makeBot('tough', { strength: [estimate('zerg', 1800)] }),
    makeBot('gentle', { strength: [estimate('zerg', 1200)] }),
    makeBot('multi', { strength: [estimate('zerg', 1900), estimate('terran', 1480)] }),
    makeBot('provisional', { strength: [estimate('zerg', 1500, 'provisional')] }),
    makeBot('unrated'),
  ]

  test('even band returns the closest calibrated bots only', () => {
    const results = recommendBots(bots, 1500, 'even')
    expect(results.map(r => r.bot.key)).toEqual(['multi', 'even'])
    expect(results[0].race).toBe('terran')
  })

  test('gentler and tougher bands', () => {
    expect(recommendBots(bots, 1500, 'gentler').map(r => r.bot.key)).toEqual(['gentle'])
    expect(recommendBots(bots, 1500, 'tougher').map(r => r.bot.key)).toEqual(['tough', 'multi'])
  })

  test('hasAnyCalibratedBot ignores provisional estimates', () => {
    expect(hasAnyCalibratedBot([bots[4], bots[5]])).toBe(false)
    expect(hasAnyCalibratedBot(bots)).toBe(true)
  })
})

describe('common/bots/practice-logic/pickDailyItem', () => {
  test('picks nothing from an empty list', () => {
    expect(pickDailyItem([], '2026-9-22')).toBeUndefined()
  })

  test('is stable within a day and covers the list across days', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f']
    expect(pickDailyItem(items, '2026-9-22')).toBe(pickDailyItem(items, '2026-9-22'))
    const seen = new Set<string>()
    for (let day = 1; day <= 30; day++) {
      seen.add(pickDailyItem(items, `2026-9-${day}`)!)
    }
    expect(seen.size).toBe(items.length)
  })

  test('day keys follow the local calendar date', () => {
    expect(localDayKey(new Date(2026, 8, 22, 23, 59))).toBe('2026-9-22')
    expect(localDayKey(new Date(2026, 8, 23, 0, 0))).toBe('2026-9-23')
  })
})
