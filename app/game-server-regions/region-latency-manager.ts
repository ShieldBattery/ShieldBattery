import { EventEmitter } from 'node:events'
import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { singleton } from 'tsyringe'
import { GameServerRegionLatencies } from '../../common/game-server-regions'
import { measureRegionLatency } from './region-latency-measurement'
import { GameServerRegionList } from './region-list'

const FINGERPRINT_POLL_INTERVAL_MS = 30_000
const PERIODIC_SWEEP_INTERVAL_MS = 3 * 60 * 60 * 1000

type RegionLatencyManagerEvents = {
  /** Fired with the full region -> latency table after each completed sweep. */
  updated: [latencies: Readonly<GameServerRegionLatencies>]
}

async function loadPersistedLatencies(filePath: string): Promise<GameServerRegionLatencies> {
  try {
    const contents = await fsPromises.readFile(filePath, { encoding: 'utf8' })
    return JSON.parse(contents) as GameServerRegionLatencies
  } catch (err) {
    // Missing/corrupt file just means there's no stale hint to show yet.
    return {}
  }
}

async function savePersistedLatencies(
  filePath: string,
  latencies: GameServerRegionLatencies,
): Promise<void> {
  await fsPromises.writeFile(filePath, JSON.stringify(latencies), { encoding: 'utf8' })
}

/**
 * Logs through the app's shared logger, falling back to the console if it can't initialize (it
 * requires a real Electron process, so this module can still be loaded -- e.g. under plain Node
 * for unit tests -- without that logger being available).
 */
async function log(level: 'verbose' | 'error', message: string): Promise<void> {
  try {
    const { default: logger } = await import('../logger')
    logger[level](message)
  } catch {
    console.error(message)
  }
}

/**
 * A fingerprint of the machine's non-internal network addresses. Changes whenever the set of
 * addresses changes (e.g. joining a different Wi-Fi network, connecting/disconnecting a VPN), which
 * is a reasonable proxy for "latency to the outside world may have changed".
 */
export function computeNetworkFingerprint(
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]>,
): string {
  const addresses: string[] = []
  for (const infos of Object.values(interfaces)) {
    for (const info of infos ?? []) {
      if (!info.internal) {
        addresses.push(`${info.family}:${info.address}`)
      }
    }
  }
  addresses.sort()
  return addresses.join(',')
}

/**
 * Resolves the default path to persist the latency table at, beside the app's other local state.
 * Loaded lazily (rather than imported statically) because `../user-data-path` reaches into
 * `electron`/`electron-is-dev`, which throw immediately at import time outside a real Electron
 * process (e.g. this module loaded under plain Node for unit tests).
 */
async function defaultPersistFilePath(): Promise<string> {
  const { getUserDataPath } = await import('../user-data-path')
  return path.join(getUserDataPath(), 'region-latencies.json')
}

/**
 * Subscribes to Electron's `powerMonitor` 'resume' event (a woken laptop is usually on a different
 * network than when it slept). Guarded because this module is also loaded under plain Node (unit
 * tests, tooling), where the 'electron' package resolves to the CLI binary path rather than its API
 * surface, and `powerMonitor` is unavailable.
 */
async function defaultSubscribeToResume(onResume: () => void): Promise<() => void> {
  try {
    const electron = await import('electron')
    if (typeof electron.powerMonitor?.on === 'function') {
      electron.powerMonitor.on('resume', onResume)
      return () => electron.powerMonitor.off('resume', onResume)
    }
  } catch (err: any) {
    log('verbose', `region latency manager: powerMonitor unavailable: ${err.stack ?? err}`).catch(
      () => {},
    )
  }
  return () => {}
}

/**
 * Maintains a region -> latency table, re-measured on region list changes, network changes, and a
 * periodic timer.
 */
@singleton()
export class RegionLatencyManager extends EventEmitter<RegionLatencyManagerEvents> {
  /** Swappable in tests; defaults to the real network measurement. */
  measureRegion = measureRegionLatency
  /** Swappable in tests; defaults to the real network interface list. */
  networkInterfaces = os.networkInterfaces
  /** Swappable in tests; defaults to a file beside the app's other local state. */
  persistFilePath: () => Promise<string> = defaultPersistFilePath
  /** Swappable in tests; defaults to subscribing to Electron's powerMonitor 'resume' event. */
  subscribeToResume: (onResume: () => void) => Promise<() => void> = defaultSubscribeToResume

  private latencies: GameServerRegionLatencies = {}
  private sweeping = false
  private sweepQueued = false
  private lastFingerprint = ''
  private unsubscribeResume?: () => void
  private fingerprintPollHandle?: NodeJS.Timeout
  private periodicSweepHandle?: NodeJS.Timeout

  constructor(private regionList: GameServerRegionList) {
    super()
    this.regionList.on('change', () => this.requestSweep())
  }

  getLatencies(): Readonly<GameServerRegionLatencies> {
    return this.latencies
  }

  /**
   * Requests a sweep. If one is already running, coalesces this request with any other requests
   * made while it's in flight into a single follow-up sweep, rather than queuing one per request.
   */
  requestSweep() {
    if (this.sweeping) {
      this.sweepQueued = true
      return
    }
    this.runSweep()
  }

  /**
   * Begins periodic re-measurement and loads any persisted table for display in the meantime.
   * Never rejects (errors are logged), so callers don't need to handle a rejection, but may await
   * it to know the persisted table has been loaded and the startup sweep requested.
   */
  start(): Promise<void> {
    return this.startInternal().catch(err => {
      log('error', `error starting region latency manager: ${err.stack ?? err}`).catch(() => {})
    })
  }

  stop() {
    this.unsubscribeResume?.()
    this.unsubscribeResume = undefined
    if (this.fingerprintPollHandle) {
      clearInterval(this.fingerprintPollHandle)
      this.fingerprintPollHandle = undefined
    }
    if (this.periodicSweepHandle) {
      clearInterval(this.periodicSweepHandle)
      this.periodicSweepHandle = undefined
    }
  }

  private async startInternal() {
    this.latencies = await loadPersistedLatencies(await this.persistFilePath())

    this.lastFingerprint = computeNetworkFingerprint(this.networkInterfaces())
    this.fingerprintPollHandle = setInterval(
      () => this.checkFingerprint(),
      FINGERPRINT_POLL_INTERVAL_MS,
    )
    this.periodicSweepHandle = setInterval(() => this.requestSweep(), PERIODIC_SWEEP_INTERVAL_MS)
    this.unsubscribeResume = await this.subscribeToResume(() => this.requestSweep())

    // Persisted values are stale hints only; they must never suppress this startup sweep.
    this.requestSweep()
  }

  private checkFingerprint() {
    const fingerprint = computeNetworkFingerprint(this.networkInterfaces())
    if (fingerprint !== this.lastFingerprint) {
      this.lastFingerprint = fingerprint
      this.requestSweep()
    }
  }

  private runSweep() {
    this.sweeping = true
    this.sweepOnce()
      .catch(err => {
        log('error', `error sweeping region latencies: ${err.stack ?? err}`).catch(() => {})
      })
      .finally(() => {
        this.sweeping = false
        if (this.sweepQueued) {
          this.sweepQueued = false
          this.runSweep()
        }
      })
  }

  private async sweepOnce() {
    const regions = this.regionList.getRegions()
    const measured = await Promise.all(
      regions.map(async region => [region.id, await this.measureRegion(region)] as const),
    )

    // A region whose measurement failed this sweep keeps its previous entry rather than vanishing:
    // a transient beacon/fallback hiccup shouldn't empty the inputs to region auto-selection or the
    // settings display, and `measuredAt` already lets consumers judge how stale an entry is. Only
    // regions no longer in the list drop out (the loop covers only current regions).
    const latencies: GameServerRegionLatencies = {}
    for (const [regionId, result] of measured) {
      const kept = result ?? this.latencies[regionId]
      if (kept) {
        latencies[regionId] = kept
      }
    }

    this.latencies = latencies

    try {
      await savePersistedLatencies(await this.persistFilePath(), latencies)
    } catch (err: any) {
      log('error', `error persisting region latencies: ${err.stack ?? err}`).catch(() => {})
    }

    this.emit('updated', latencies)
  }
}
