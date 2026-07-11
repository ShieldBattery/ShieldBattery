import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { makeGameServerRegionId } from '../../common/game-server-regions'
import { computeNetworkFingerprint, RegionLatencyManager } from './region-latency-manager'
import { GameServerRegionList } from './region-list'

const REGION_A = {
  id: makeGameServerRegionId('region-a'),
  displayName: 'Region A',
  beacon: '127.0.0.1:1',
  fallback: '127.0.0.1:2',
}

function delay(millis: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, millis))
}

/** Polls `predicate` until it's true, rather than guessing how many event-loop turns async work needs. */
async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('Timed out waiting for condition')
    }
    await delay(5)
  }
}

async function makeTempPersistPath(): Promise<string> {
  const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'sb-region-latency-'))
  return path.join(dir, 'region-latencies.json')
}

describe('RegionLatencyManager', () => {
  const managers: RegionLatencyManager[] = []

  afterEach(() => {
    for (const manager of managers) {
      manager.stop()
    }
    managers.length = 0
  })

  function makeManager(regionList = new GameServerRegionList()): RegionLatencyManager {
    const manager = new RegionLatencyManager(regionList)
    managers.push(manager)
    return manager
  }

  it('coalesces sweep requests made while a sweep is in flight into a single follow-up', async () => {
    const regionList = new GameServerRegionList()
    regionList.setRegions([REGION_A])
    const manager = makeManager(regionList)
    manager.persistFilePath = async () => path.join(os.tmpdir(), 'sb-region-latency-unused.json')

    const resolvers: Array<() => void> = []
    let callCount = 0
    manager.measureRegion = () =>
      new Promise(resolve => {
        callCount++
        resolvers.push(() => resolve(undefined))
      })

    manager.requestSweep()
    await waitUntil(() => callCount === 1)

    // Requested twice more while the first sweep is in flight -- should coalesce into exactly one
    // follow-up sweep, not one per request.
    manager.requestSweep()
    manager.requestSweep()
    await delay(30)
    expect(callCount).toBe(1)

    resolvers[0]()
    await waitUntil(() => callCount === 2)

    resolvers[1]()
    await delay(30)
    // No further requests came in after the coalesced follow-up, so no third sweep.
    expect(callCount).toBe(2)
  })

  it('runs a sweep and emits the result when the region list changes', async () => {
    const regionList = new GameServerRegionList()
    const manager = makeManager(regionList)
    manager.persistFilePath = async () => path.join(os.tmpdir(), 'sb-region-latency-unused2.json')
    manager.measureRegion = async region => ({
      regionId: region.id,
      rttMs: 42,
      source: 'beacon' as const,
      measuredAt: Date.now(),
    })

    let updateCount = 0
    manager.on('updated', () => updateCount++)

    regionList.setRegions([REGION_A])
    await waitUntil(() => updateCount === 1)

    expect(manager.getLatencies()[REGION_A.id]?.rttMs).toBe(42)
  })

  it('stays absent when a never-measured region fails its measurement', async () => {
    const regionList = new GameServerRegionList()
    const manager = makeManager(regionList)
    manager.persistFilePath = async () => path.join(os.tmpdir(), 'sb-region-latency-unused3.json')
    manager.measureRegion = async () => undefined

    let updateCount = 0
    manager.on('updated', () => updateCount++)

    regionList.setRegions([REGION_A])
    await waitUntil(() => updateCount === 1)

    expect(manager.getLatencies()[REGION_A.id]).toBeUndefined()
  })

  it('keeps the previous entry when a measured region fails a later sweep', async () => {
    const regionList = new GameServerRegionList()
    const manager = makeManager(regionList)
    manager.persistFilePath = async () => path.join(os.tmpdir(), 'sb-region-latency-unused3a.json')

    const firstResult = {
      regionId: REGION_A.id,
      rttMs: 42,
      source: 'beacon' as const,
      measuredAt: 12345,
    }
    manager.measureRegion = async () => firstResult

    let updateCount = 0
    manager.on('updated', () => updateCount++)

    regionList.setRegions([REGION_A])
    await waitUntil(() => updateCount === 1)

    // A transient failure must serve the last-known entry (its measuredAt marks the staleness)
    // rather than emptying the auto-selection inputs.
    manager.measureRegion = async () => undefined
    manager.requestSweep()
    await waitUntil(() => updateCount === 2)

    expect(manager.getLatencies()[REGION_A.id]).toEqual(firstResult)
  })

  it('drops entries for regions no longer in the list', async () => {
    const regionList = new GameServerRegionList()
    const manager = makeManager(regionList)
    manager.persistFilePath = async () => path.join(os.tmpdir(), 'sb-region-latency-unused3b.json')
    manager.measureRegion = async region => ({
      regionId: region.id,
      rttMs: 42,
      source: 'beacon' as const,
      measuredAt: Date.now(),
    })

    let updateCount = 0
    manager.on('updated', () => updateCount++)

    regionList.setRegions([REGION_A])
    await waitUntil(() => updateCount === 1)
    expect(manager.getLatencies()[REGION_A.id]).toBeDefined()

    regionList.setRegions([])
    await waitUntil(() => updateCount === 2)
    expect(manager.getLatencies()[REGION_A.id]).toBeUndefined()
  })

  it('persists the table to disk after a sweep completes', async () => {
    const persistPath = await makeTempPersistPath()
    const regionList = new GameServerRegionList()
    regionList.setRegions([REGION_A])

    const writer = makeManager(regionList)
    writer.persistFilePath = async () => persistPath
    writer.measureRegion = async region => ({
      regionId: region.id,
      rttMs: 17,
      source: 'beacon' as const,
      measuredAt: Date.now(),
    })

    let updated = false
    writer.on('updated', () => {
      updated = true
    })
    writer.requestSweep()
    await waitUntil(() => updated)

    const onDiskRaw = await fsPromises.readFile(persistPath, { encoding: 'utf8' })
    expect(JSON.parse(onDiskRaw)[REGION_A.id].rttMs).toBe(17)
  })

  it('reloads a persisted table as a stale hint, without letting it suppress the startup sweep', async () => {
    const persistPath = await makeTempPersistPath()
    await fsPromises.writeFile(
      persistPath,
      JSON.stringify({
        [REGION_A.id]: { regionId: REGION_A.id, rttMs: 17, source: 'beacon', measuredAt: 123 },
      }),
      { encoding: 'utf8' },
    )

    const regionList = new GameServerRegionList()
    regionList.setRegions([REGION_A])
    const reader = makeManager(regionList)
    reader.persistFilePath = async () => persistPath

    let releaseSweep: () => void = () => {}
    reader.measureRegion = region =>
      new Promise(resolve => {
        releaseSweep = () =>
          resolve({ regionId: region.id, rttMs: 99, source: 'beacon', measuredAt: Date.now() })
      })

    await reader.start()
    // The startup sweep is deliberately kept in flight (measureRegion hasn't resolved yet), but
    // the persisted value should already be visible.
    expect(reader.getLatencies()[REGION_A.id]?.rttMs).toBe(17)

    let updated = false
    reader.on('updated', () => {
      updated = true
    })
    releaseSweep()
    await waitUntil(() => updated)

    // The startup sweep ran despite the persisted hint, and its fresh measurement replaces the
    // stale value.
    expect(reader.getLatencies()[REGION_A.id]?.rttMs).toBe(99)
  })

  it('starts without throwing on plain Node, where Electron APIs are unavailable', async () => {
    const persistPath = await makeTempPersistPath()
    const manager = makeManager(new GameServerRegionList())
    manager.persistFilePath = async () => persistPath

    await expect(manager.start()).resolves.toBeUndefined()

    expect(manager.getLatencies()).toEqual({})
  })
})

describe('computeNetworkFingerprint', () => {
  function iface(address: string, internal: boolean, family: 'IPv4' | 'IPv6' = 'IPv4') {
    return {
      address,
      netmask: '255.255.255.0',
      family,
      mac: '00:00:00:00:00:00',
      internal,
      cidr: null,
    } as os.NetworkInterfaceInfo
  }

  it('excludes internal addresses', () => {
    const fingerprint = computeNetworkFingerprint({
      lo: [iface('127.0.0.1', true)],
      eth0: [iface('192.168.1.5', false)],
    })

    expect(fingerprint).toBe('IPv4:192.168.1.5')
  })

  it('is stable regardless of interface key order', () => {
    const a = computeNetworkFingerprint({
      eth0: [iface('192.168.1.5', false)],
      wlan0: [iface('192.168.1.6', false)],
    })
    const b = computeNetworkFingerprint({
      wlan0: [iface('192.168.1.6', false)],
      eth0: [iface('192.168.1.5', false)],
    })

    expect(a).toBe(b)
  })

  it('changes when the address set changes', () => {
    const before = computeNetworkFingerprint({ eth0: [iface('192.168.1.5', false)] })
    const after = computeNetworkFingerprint({ eth0: [iface('10.0.0.5', false)] })

    expect(before).not.toBe(after)
  })
})
