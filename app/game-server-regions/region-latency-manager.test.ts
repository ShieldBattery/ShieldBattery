import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeGameServerRegionId } from '../../common/game-server-regions'
import {
  computeNetworkFingerprint,
  REGION_STAGGER_MS,
  RegionLatencyManager,
  STARTUP_SWEEP_DELAY_MS,
} from './region-latency-manager'
import { GameServerRegionList } from './region-list'

const REGION_A = {
  id: makeGameServerRegionId('region-a'),
  displayName: 'Region A',
  beacon: '127.0.0.1:1',
  fallback: '127.0.0.1:2',
}
const REGION_B = {
  id: makeGameServerRegionId('region-b'),
  displayName: 'Region B',
  beacon: '127.0.0.1:3',
  fallback: '127.0.0.1:4',
}
const REGION_C = {
  id: makeGameServerRegionId('region-c'),
  displayName: 'Region C',
  beacon: '127.0.0.1:5',
  fallback: '127.0.0.1:6',
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

    // Collapses the startup settling delay so this sweep runs now instead of after
    // STARTUP_SWEEP_DELAY_MS -- see the dedicated startup-delay tests below for that behavior.
    manager.ensureSweepNow()
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
    // The region-list change is coalesced into the pending startup sweep rather than running one
    // immediately -- collapse the delay so this test doesn't need to wait it out.
    manager.ensureSweepNow()
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
    manager.ensureSweepNow()
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
    manager.ensureSweepNow()
    await waitUntil(() => updateCount === 1)

    // A transient failure must serve the last-known entry (its measuredAt marks the staleness)
    // rather than emptying the auto-selection inputs.
    manager.measureRegion = async () => undefined
    manager.requestSweep()
    await waitUntil(() => updateCount === 2)

    expect(manager.getLatencies()[REGION_A.id]).toEqual(firstResult)
  })

  it('drops entries for regions no longer in the list, but an empty list erases nothing', async () => {
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

    regionList.setRegions([REGION_A, REGION_B])
    manager.ensureSweepNow()
    await waitUntil(() => updateCount === 1)
    expect(manager.getLatencies()[REGION_A.id]).toBeDefined()
    expect(manager.getLatencies()[REGION_B.id]).toBeDefined()

    // A retired region's entry drops out on the next sweep of the (non-empty) current list.
    regionList.setRegions([REGION_B])
    await waitUntil(() => updateCount === 2)
    expect(manager.getLatencies()[REGION_A.id]).toBeUndefined()
    expect(manager.getLatencies()[REGION_B.id]).toBeDefined()

    // An empty list measures nothing, so sweeping it could only erase the table's stale-hint
    // value -- the sweep is skipped and the entries are retained (they're inert: auto-selection
    // filters against the live list).
    regionList.setRegions([])
    await delay(50)
    expect(updateCount).toBe(2)
    expect(manager.getLatencies()[REGION_B.id]).toBeDefined()
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
    writer.ensureSweepNow()
    await waitUntil(() => updated)

    const onDiskRaw = await fsPromises.readFile(persistPath, { encoding: 'utf8' })
    expect(JSON.parse(onDiskRaw)[REGION_A.id].rttMs).toBe(17)
  })

  it('skips the disk write when a sweep produces an unchanged table', async () => {
    const persistPath = await makeTempPersistPath()
    const regionList = new GameServerRegionList()
    const manager = makeManager(regionList)
    manager.persistFilePath = async () => persistPath

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
    manager.ensureSweepNow()
    await waitUntil(() => updateCount === 1)

    const writeSpy = vi.spyOn(fsPromises, 'writeFile')
    try {
      // The measurement fails on this sweep, so the previous (already-persisted) entry carries
      // forward unchanged -- there's nothing new to write.
      manager.measureRegion = async () => undefined
      manager.requestSweep()
      await waitUntil(() => updateCount === 2)

      expect(writeSpy).not.toHaveBeenCalled()
    } finally {
      writeSpy.mockRestore()
    }
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
    // The persisted value should already be visible even though the startup sweep hasn't run yet
    // (it's waiting out the settling delay).
    expect(reader.getLatencies()[REGION_A.id]?.rttMs).toBe(17)

    // Collapse the delay so the startup sweep runs now; it's deliberately kept in flight
    // (measureRegion hasn't resolved yet) for the assertions below.
    reader.ensureSweepNow()

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

  it('does not run the startup sweep before the settling delay elapses, and runs it after', async () => {
    vi.useFakeTimers()
    const regionList = new GameServerRegionList()
    regionList.setRegions([REGION_A])
    const manager = makeManager(regionList)
    try {
      manager.persistFilePath = async () =>
        path.join(os.tmpdir(), 'sb-region-latency-unused-startup1.json')

      let callCount = 0
      manager.measureRegion = async region => {
        callCount++
        return { regionId: region.id, rttMs: 5, source: 'beacon' as const, measuredAt: Date.now() }
      }

      await manager.start()
      expect(callCount).toBe(0)

      await vi.advanceTimersByTimeAsync(STARTUP_SWEEP_DELAY_MS - 1)
      expect(callCount).toBe(0)

      await vi.advanceTimersByTimeAsync(1)
      expect(callCount).toBe(1)
    } finally {
      manager.stop()
      vi.useRealTimers()
    }
  })

  it('coalesces a region-list change during the startup window into the delayed sweep, instead of bypassing the delay', async () => {
    vi.useFakeTimers()
    const regionList = new GameServerRegionList()
    const manager = makeManager(regionList)
    try {
      manager.persistFilePath = async () =>
        path.join(os.tmpdir(), 'sb-region-latency-unused-startup2.json')

      let callCount = 0
      manager.measureRegion = async region => {
        callCount++
        return { regionId: region.id, rttMs: 5, source: 'beacon' as const, measuredAt: Date.now() }
      }

      await manager.start()

      // Mimics the region list loading from the server shortly after startup: still within the
      // settling window, so it must not trigger an immediate sweep of its own.
      await vi.advanceTimersByTimeAsync(STARTUP_SWEEP_DELAY_MS - 1000)
      regionList.setRegions([REGION_A])
      expect(callCount).toBe(0)

      await vi.advanceTimersByTimeAsync(1000)
      expect(callCount).toBe(1)
      expect(manager.getLatencies()[REGION_A.id]?.rttMs).toBe(5)
    } finally {
      manager.stop()
      vi.useRealTimers()
    }
  })

  it('ensureSweepNow collapses the startup delay and runs the sweep immediately, without a duplicate sweep once the original delay would have elapsed', async () => {
    vi.useFakeTimers()
    const regionList = new GameServerRegionList()
    regionList.setRegions([REGION_A])
    const manager = makeManager(regionList)
    try {
      manager.persistFilePath = async () =>
        path.join(os.tmpdir(), 'sb-region-latency-unused-startup3.json')

      let callCount = 0
      manager.measureRegion = async region => {
        callCount++
        return { regionId: region.id, rttMs: 5, source: 'beacon' as const, measuredAt: Date.now() }
      }

      await manager.start()
      manager.ensureSweepNow()
      await vi.advanceTimersByTimeAsync(0)
      expect(callCount).toBe(1)

      await vi.advanceTimersByTimeAsync(STARTUP_SWEEP_DELAY_MS)
      expect(callCount).toBe(1)
    } finally {
      manager.stop()
      vi.useRealTimers()
    }
  })

  it('ensureSweepNow is a no-op once the startup delay has elapsed and the table is already populated', async () => {
    vi.useFakeTimers()
    const regionList = new GameServerRegionList()
    regionList.setRegions([REGION_A])
    const manager = makeManager(regionList)
    try {
      manager.persistFilePath = async () =>
        path.join(os.tmpdir(), 'sb-region-latency-unused-startup4.json')

      let callCount = 0
      manager.measureRegion = async region => {
        callCount++
        return { regionId: region.id, rttMs: 5, source: 'beacon' as const, measuredAt: Date.now() }
      }

      await manager.start()
      await vi.advanceTimersByTimeAsync(STARTUP_SWEEP_DELAY_MS)
      expect(callCount).toBe(1)

      manager.ensureSweepNow()
      await vi.advanceTimersByTimeAsync(0)
      expect(callCount).toBe(1)
    } finally {
      manager.stop()
      vi.useRealTimers()
    }
  })

  it('ensureSweepNow during an in-flight sweep queues no redundant follow-up', async () => {
    const regionList = new GameServerRegionList()
    regionList.setRegions([REGION_A])
    const manager = makeManager(regionList)
    manager.persistFilePath = async () =>
      path.join(os.tmpdir(), 'sb-region-latency-unused-inflight.json')

    let callCount = 0
    const resolvers: Array<() => void> = []
    manager.measureRegion = region =>
      new Promise(resolve => {
        callCount++
        resolvers.push(() =>
          resolve({ regionId: region.id, rttMs: 42, source: 'beacon', measuredAt: Date.now() }),
        )
      })

    manager.ensureSweepNow()
    await waitUntil(() => callCount === 1)

    // The table is still empty (the first sweep hasn't finished), but that sweep is already
    // producing the first measurements -- ensuring again must not queue a second full sweep
    // right as the player queues.
    manager.ensureSweepNow()
    resolvers[0]()
    await delay(30)
    expect(callCount).toBe(1)
  })

  it('ensureSweepNow retries after a completed sweep produced no measurements', async () => {
    const regionList = new GameServerRegionList()
    regionList.setRegions([REGION_A])
    const manager = makeManager(regionList)
    manager.persistFilePath = async () =>
      path.join(os.tmpdir(), 'sb-region-latency-unused-retry.json')
    manager.measureRegion = async () => undefined

    let updateCount = 0
    manager.on('updated', () => updateCount++)

    manager.ensureSweepNow()
    await waitUntil(() => updateCount === 1)
    expect(manager.getLatencies()[REGION_A.id]).toBeUndefined()

    // Every region failed the first sweep and nothing is in flight anymore: a later ensure runs
    // a fresh sweep rather than leaving the table empty forever.
    manager.measureRegion = async region => ({
      regionId: region.id,
      rttMs: 42,
      source: 'beacon' as const,
      measuredAt: Date.now(),
    })
    manager.ensureSweepNow()
    await waitUntil(() => updateCount === 2)
    expect(manager.getLatencies()[REGION_A.id]?.rttMs).toBe(42)
  })

  it('an ensureSweepNow that beats start() keeps its results and arms no duplicate startup sweep', async () => {
    vi.useFakeTimers()
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
    const manager = makeManager(regionList)
    try {
      manager.persistFilePath = async () => persistPath

      let callCount = 0
      manager.measureRegion = async region => {
        callCount++
        return { regionId: region.id, rttMs: 99, source: 'beacon' as const, measuredAt: Date.now() }
      }

      // The IPC surface is exposed before manager startup finishes, so an ensure can arrive
      // first (a player queueing immediately at launch).
      const updated = new Promise<void>(resolve => manager.once('updated', () => resolve()))
      manager.ensureSweepNow()
      await updated
      expect(callCount).toBe(1)
      expect(manager.getLatencies()[REGION_A.id]?.rttMs).toBe(99)

      // Startup's persisted-table load fills in under the fresh measurement, never over it.
      await manager.start()
      expect(manager.getLatencies()[REGION_A.id]?.rttMs).toBe(99)

      // And the startup timer was not armed on top of the already-collapsed delay: no second
      // "startup" sweep fires when the delay would have elapsed.
      await vi.advanceTimersByTimeAsync(STARTUP_SWEEP_DELAY_MS + 1000)
      expect(callCount).toBe(1)
    } finally {
      manager.stop()
      vi.useRealTimers()
    }
  })

  it('a settled list delivery re-sweeps when the table is stale, gated on sweep freshness', async () => {
    const regionList = new GameServerRegionList()
    regionList.setRegions([REGION_A])
    const manager = makeManager(regionList)
    manager.persistFilePath = async () =>
      path.join(os.tmpdir(), 'sb-region-latency-unused-delivery.json')

    let callCount = 0
    manager.measureRegion = async region => {
      callCount++
      return { regionId: region.id, rttMs: 5, source: 'beacon' as const, measuredAt: Date.now() }
    }

    let updateCount = 0
    manager.on('updated', () => updateCount++)

    manager.ensureSweepNow()
    await waitUntil(() => updateCount === 1)
    expect(callCount).toBe(1)

    // A reconnect re-delivers the unchanged list right after a sweep completed: the freshness
    // gate keeps it from turning reconnect churn into a sweep per flap.
    manager.noteListDelivered()
    await delay(30)
    expect(callCount).toBe(1)

    // Much later (modeled by zeroing the freshness window), the same re-delivery means the
    // network path may have changed while the interface fingerprint did not -- so it re-sweeps.
    manager.deliveryResweepMinAgeMs = 0
    manager.noteListDelivered()
    await waitUntil(() => updateCount === 2)
    expect(callCount).toBe(2)
  })

  it('a freshness-suppressed delivery still produces one trailing sweep at the boundary', async () => {
    const regionList = new GameServerRegionList()
    regionList.setRegions([REGION_A])
    const manager = makeManager(regionList)
    manager.persistFilePath = async () =>
      path.join(os.tmpdir(), 'sb-region-latency-unused-delivery3.json')
    manager.deliveryResweepMinAgeMs = 40

    let callCount = 0
    manager.measureRegion = async region => {
      callCount++
      return { regionId: region.id, rttMs: 5, source: 'beacon' as const, measuredAt: Date.now() }
    }
    let updateCount = 0
    manager.on('updated', () => updateCount++)

    manager.ensureSweepNow()
    await waitUntil(() => updateCount === 1)

    // A network switch ten seconds after a sweep re-delivers the list inside the freshness
    // window. The delivery must not be dropped outright -- with an unchanged interface
    // fingerprint, the next guaranteed trigger would otherwise be the three-hour timer.
    manager.noteListDelivered()
    await delay(10)
    expect(callCount).toBe(1)

    // The owed refresh runs once the freshness boundary passes.
    await waitUntil(() => updateCount === 2)
    expect(callCount).toBe(2)
  })

  it('a reconnect storm coalesces into a single trailing sweep', async () => {
    const regionList = new GameServerRegionList()
    regionList.setRegions([REGION_A])
    const manager = makeManager(regionList)
    manager.persistFilePath = async () =>
      path.join(os.tmpdir(), 'sb-region-latency-unused-delivery4.json')
    manager.deliveryResweepMinAgeMs = 40

    let callCount = 0
    manager.measureRegion = async region => {
      callCount++
      return { regionId: region.id, rttMs: 5, source: 'beacon' as const, measuredAt: Date.now() }
    }
    let updateCount = 0
    manager.on('updated', () => updateCount++)

    manager.ensureSweepNow()
    await waitUntil(() => updateCount === 1)

    // A flapping connection delivers the list once per flap; every one lands inside the
    // freshness window and all of them collapse into the single armed trailing refresh.
    for (let i = 0; i < 5; i++) {
      manager.noteListDelivered()
    }
    await waitUntil(() => updateCount === 2)
    await delay(60)
    expect(callCount).toBe(2)
  })

  it('a delivery during an in-flight sweep still gets a trailing sweep afterward', async () => {
    const regionList = new GameServerRegionList()
    regionList.setRegions([REGION_A])
    const manager = makeManager(regionList)
    manager.persistFilePath = async () =>
      path.join(os.tmpdir(), 'sb-region-latency-unused-delivery5.json')
    manager.deliveryResweepMinAgeMs = 40

    let callCount = 0
    const resolvers: Array<() => void> = []
    manager.measureRegion = region =>
      new Promise(resolve => {
        callCount++
        resolvers.push(() =>
          resolve({ regionId: region.id, rttMs: 42, source: 'beacon', measuredAt: Date.now() }),
        )
      })
    let updateCount = 0
    manager.on('updated', () => updateCount++)

    manager.ensureSweepNow()
    await waitUntil(() => callCount === 1)

    // The in-flight sweep's measurements may predate whatever path change this delivery
    // signals, so completing it doesn't discharge the delivery -- the trailing refresh still
    // runs once the completed sweep's freshness window passes.
    manager.noteListDelivered()
    resolvers[0]()
    await waitUntil(() => updateCount === 1)
    expect(callCount).toBe(1)

    await waitUntil(() => callCount === 2)
    resolvers[1]()
    await waitUntil(() => updateCount === 2)
  })

  it('a queued sweep that starts after the delivery discharges the trailing refresh', async () => {
    const regionList = new GameServerRegionList()
    regionList.setRegions([REGION_A])
    const manager = makeManager(regionList)
    manager.persistFilePath = async () =>
      path.join(os.tmpdir(), 'sb-region-latency-unused-delivery6.json')
    manager.deliveryResweepMinAgeMs = 40

    let callCount = 0
    const resolvers: Array<() => void> = []
    manager.measureRegion = region =>
      new Promise(resolve => {
        callCount++
        resolvers.push(() =>
          resolve({ regionId: region.id, rttMs: 42, source: 'beacon', measuredAt: Date.now() }),
        )
      })
    let updateCount = 0
    manager.on('updated', () => updateCount++)

    manager.ensureSweepNow()
    await waitUntil(() => callCount === 1)

    // A changed-list delivery during sweep A: the list change queues follow-up sweep B, and the
    // delivery note marks the trailing refresh. B starts after the delivery, so it measures the
    // delivered list over the current path -- it must discharge the trailing refresh rather
    // than leave a redundant sweep C scheduled behind it.
    manager.requestSweep()
    manager.noteListDelivered()
    resolvers[0]()
    await waitUntil(() => callCount === 2)
    resolvers[1]()
    await waitUntil(() => updateCount === 2)

    await delay(100)
    expect(callCount).toBe(2)
  })

  it('a covering sweep cancels an armed trailing timer instead of letting it fire right after', async () => {
    const regionList = new GameServerRegionList()
    regionList.setRegions([REGION_A])
    const manager = makeManager(regionList)
    manager.persistFilePath = async () =>
      path.join(os.tmpdir(), 'sb-region-latency-unused-delivery7.json')
    manager.deliveryResweepMinAgeMs = 100

    let callCount = 0
    manager.measureRegion = async region => {
      callCount++
      return { regionId: region.id, rttMs: 5, source: 'beacon' as const, measuredAt: Date.now() }
    }
    let updateCount = 0
    manager.on('updated', () => updateCount++)

    manager.ensureSweepNow()
    await waitUntil(() => updateCount === 1)

    // A suppressed delivery arms the trailing timer...
    manager.noteListDelivered()
    // ...and then an unrelated trigger (a fingerprint change, say) sweeps before it fires. That
    // sweep covers the delivery, so the old timer must not produce a back-to-back third sweep
    // when its (stale) deadline passes.
    manager.requestSweep()
    await waitUntil(() => updateCount === 2)
    expect(callCount).toBe(2)
    await delay(150)
    expect(callCount).toBe(2)

    // A delivery after the covering sweep still earns its own trailing refresh.
    manager.noteListDelivered()
    await waitUntil(() => updateCount === 3)
    expect(callCount).toBe(3)
  })

  it('a list delivery during an in-flight sweep queues no immediate follow-up', async () => {
    const regionList = new GameServerRegionList()
    regionList.setRegions([REGION_A])
    const manager = makeManager(regionList)
    manager.persistFilePath = async () =>
      path.join(os.tmpdir(), 'sb-region-latency-unused-delivery2.json')

    let callCount = 0
    const resolvers: Array<() => void> = []
    manager.measureRegion = region =>
      new Promise(resolve => {
        callCount++
        resolvers.push(() =>
          resolve({ regionId: region.id, rttMs: 42, source: 'beacon', measuredAt: Date.now() }),
        )
      })

    manager.ensureSweepNow()
    await waitUntil(() => callCount === 1)

    // The in-flight sweep is already measuring the freshly delivered list.
    manager.noteListDelivered()
    resolvers[0]()
    await delay(30)
    expect(callCount).toBe(1)
  })

  it('staggers per-region measurement starts by REGION_STAGGER_MS', async () => {
    vi.useFakeTimers()
    const regionList = new GameServerRegionList()
    regionList.setRegions([REGION_A, REGION_B, REGION_C])
    const manager = makeManager(regionList)
    try {
      manager.persistFilePath = async () =>
        path.join(os.tmpdir(), 'sb-region-latency-unused-stagger.json')

      const startTimes: number[] = []
      manager.measureRegion = async region => {
        startTimes.push(Date.now())
        return { regionId: region.id, rttMs: 5, source: 'beacon' as const, measuredAt: Date.now() }
      }

      await manager.start()
      manager.ensureSweepNow()

      await vi.advanceTimersByTimeAsync(0)
      expect(startTimes.length).toBe(1)

      await vi.advanceTimersByTimeAsync(REGION_STAGGER_MS - 1)
      expect(startTimes.length).toBe(1)

      await vi.advanceTimersByTimeAsync(1)
      expect(startTimes.length).toBe(2)

      await vi.advanceTimersByTimeAsync(REGION_STAGGER_MS - 1)
      expect(startTimes.length).toBe(2)

      await vi.advanceTimersByTimeAsync(1)
      expect(startTimes.length).toBe(3)

      expect(startTimes[1] - startTimes[0]).toBe(REGION_STAGGER_MS)
      expect(startTimes[2] - startTimes[0]).toBe(REGION_STAGGER_MS * 2)
    } finally {
      manager.stop()
      vi.useRealTimers()
    }
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
