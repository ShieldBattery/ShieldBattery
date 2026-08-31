import { EventEmitter } from 'node:events'
import fsPromises from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { singleton } from 'tsyringe'
import { GameServerRegionLatencies } from '../../common/game-server-regions'
import shallowEquals from '../../common/shallow-equals'
import { monotonicNow } from '../time/monotonic-now'
import { measureRegionLatency } from './region-latency-measurement'
import { GameServerRegionList } from './region-list'

const FINGERPRINT_POLL_INTERVAL_MS = 30_000
const PERIODIC_SWEEP_INTERVAL_MS = 3 * 60 * 60 * 1000
/**
 * How long to wait after the manager starts before running the first sweep. The app's launch
 * burst (updater checks, API fetches, renderer boot) competes for the same network link, which
 * inflates RTTs measured during that window on a congested connection. The persisted table from
 * the previous run (or an empty one) stands in as a stale-but-usable hint until this delay
 * elapses -- see `startInternal` and `ensureSweepNow`.
 */
export const STARTUP_SWEEP_DELAY_MS = 15_000
/**
 * Delay between starting successive regions' measurements within a sweep. Firing every region's
 * ping at once packs all of that traffic into the same instant, which can itself distort the
 * measured RTTs on a modest connection; spacing out the starts keeps one region's beacon traffic
 * from stepping on another's.
 */
export const REGION_STAGGER_MS = 150
/**
 * How fresh the last completed sweep must be for a re-delivered region list to NOT trigger a new
 * one -- see `noteListDelivered`. Long enough that a flapping connection's reconnect storm can't
 * turn into a sweep per flap, short enough that a genuine network switch (which usually drops the
 * socket) gets fresh RTTs promptly instead of waiting out the periodic timer.
 */
export const DELIVERY_RESWEEP_MIN_AGE_MS = 60_000

function delay(millis: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, millis))
}

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
  /** The table last written to disk, so `sweepOnce` can skip re-persisting an unchanged one. */
  private lastPersistedLatencies?: GameServerRegionLatencies
  private sweeping = false
  private sweepQueued = false
  private lastFingerprint = ''
  private unsubscribeResume?: () => void
  private fingerprintPollHandle?: NodeJS.Timeout
  private periodicSweepHandle?: NodeJS.Timeout
  /**
   * True from construction until the startup settling delay elapses (or `ensureSweepNow` cuts it
   * short). While true, `requestSweep` coalesces every request into the pending
   * `startupSweepTimer` instead of running immediately -- this is what makes the delay apply to
   * every path that can request a sweep (region-list load, network change, resume, the periodic
   * timer), not just the one `startInternal` fires directly.
   */
  private startupSweepPending = true
  private startupSweepTimer?: NodeJS.Timeout
  /** Swappable in tests; defaults to `DELIVERY_RESWEEP_MIN_AGE_MS`. */
  deliveryResweepMinAgeMs = DELIVERY_RESWEEP_MIN_AGE_MS
  /**
   * Monotonic time the last *measuring* sweep completed (a skipped empty-list sweep doesn't
   * count); undefined until one has. The freshness gate for `noteListDelivered`.
   */
  private lastSweepFinishedAt?: number
  /**
   * Whether a freshness-suppressed (or mid-sweep) list delivery still owes a trailing refresh.
   * Suppression alone would strand it: a network switch right after a sweep whose interface
   * fingerprint doesn't change has no other trigger until the three-hour periodic timer. All
   * suppressed deliveries coalesce into this one flag; the refresh runs once the freshness
   * boundary passes (see `scheduleDeliveryResweep`).
   */
  private pendingDeliveryResweep = false
  private deliveryResweepTimer?: NodeJS.Timeout

  constructor(private regionList: GameServerRegionList) {
    super()
    this.regionList.on('change', () => this.requestSweep())
  }

  getLatencies(): Readonly<GameServerRegionLatencies> {
    return this.latencies
  }

  /**
   * Notes that the site socket delivered a (settled) region list. Every reconnect re-delivers the
   * full list, and a reconnect often means the network path changed even when the interface
   * fingerprint did not (switching between similarly-addressed Wi-Fi networks, say) -- so a
   * delivery doubles as a refresh signal for the latency table, which would otherwise stay stale
   * until the periodic timer. Freshness-gated: a recently completed sweep, or one already in
   * flight (a changed list's own `change` sweep starts before this runs), doesn't sweep again
   * immediately -- but the signal is never dropped either. It coalesces into one pending trailing
   * refresh that runs at the freshness boundary, so a network switch that lands just inside the
   * gate still gets fresh RTTs a minute later instead of waiting out the periodic timer.
   */
  noteListDelivered() {
    if (this.sweeping) {
      // The in-flight sweep measures over the old path/list state; its completion arms the
      // trailing refresh (see `runSweep`).
      this.pendingDeliveryResweep = true
      return
    }
    if (this.lastSweepFinishedAt !== undefined) {
      const age = monotonicNow() - this.lastSweepFinishedAt
      if (age < this.deliveryResweepMinAgeMs) {
        this.scheduleDeliveryResweep(this.deliveryResweepMinAgeMs - age)
        return
      }
    }
    this.requestSweep()
  }

  /**
   * Arms (or leaves armed) the one coalesced trailing refresh `noteListDelivered` owes, to run in
   * `delayMs`. A reconnect storm's deliveries all land here while the timer is already armed, so
   * they collapse into the single scheduled sweep.
   */
  private scheduleDeliveryResweep(delayMs: number) {
    this.pendingDeliveryResweep = true
    if (this.deliveryResweepTimer) {
      return
    }
    this.deliveryResweepTimer = setTimeout(() => {
      this.deliveryResweepTimer = undefined
      if (this.pendingDeliveryResweep) {
        this.pendingDeliveryResweep = false
        this.requestSweep()
      }
    }, delayMs)
  }

  /**
   * Requests a sweep. While the startup settling delay is still pending, this is a no-op: the
   * timer armed in `startInternal` will run the (single) startup sweep on its own, so there's
   * nothing more for this request to do. Otherwise, if a sweep is already running, coalesces this
   * request with any other requests made while it's in flight into a single follow-up sweep,
   * rather than queuing one per request.
   */
  requestSweep() {
    if (this.startupSweepPending) {
      return
    }
    if (this.sweeping) {
      this.sweepQueued = true
      return
    }
    this.runSweep()
  }

  /**
   * Lets a caller that can't wait out the startup settling delay skip the rest of it -- used by
   * the matchmaking queue path when no usable measurement exists yet. If the delay is still
   * pending, cancels it and runs the sweep immediately. Otherwise a no-op, unless the table is
   * still empty with no sweep in flight (e.g. every region failed its startup sweep), in which
   * case it behaves like `requestSweep` -- an in-flight sweep is already producing the first
   * measurements, so queueing a follow-up would only measure every region twice, right as the
   * caller queues. Safe to call more than once: only the first call made while the delay is
   * pending has any effect.
   */
  ensureSweepNow() {
    if (this.startupSweepPending) {
      if (this.startupSweepTimer) {
        clearTimeout(this.startupSweepTimer)
        this.startupSweepTimer = undefined
      }
      this.startupSweepPending = false
      this.requestSweep()
      return
    }
    if (!this.sweeping && Object.keys(this.latencies).length === 0) {
      this.requestSweep()
    }
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
    if (this.startupSweepTimer) {
      clearTimeout(this.startupSweepTimer)
      this.startupSweepTimer = undefined
    }
    if (this.deliveryResweepTimer) {
      clearTimeout(this.deliveryResweepTimer)
      this.deliveryResweepTimer = undefined
    }
    this.pendingDeliveryResweep = false
  }

  private async startInternal() {
    // The persisted entries fill in under anything already measured, never over it: the IPC
    // surface is exposed before this initialization finishes, so an early `ensureSweepNow` (a
    // player queueing immediately at launch) can have swept before this load completes, and a
    // fresh measurement must not be replaced by a stale on-disk hint.
    const persisted = await loadPersistedLatencies(await this.persistFilePath())
    this.latencies = { ...persisted, ...this.latencies }

    this.lastFingerprint = computeNetworkFingerprint(this.networkInterfaces())
    this.fingerprintPollHandle = setInterval(
      () => this.checkFingerprint(),
      FINGERPRINT_POLL_INTERVAL_MS,
    )
    this.periodicSweepHandle = setInterval(() => this.requestSweep(), PERIODIC_SWEEP_INTERVAL_MS)
    this.unsubscribeResume = await this.subscribeToResume(() => this.requestSweep())

    // Persisted values are stale hints only; they must never suppress this startup sweep, just
    // delay it -- see `STARTUP_SWEEP_DELAY_MS`. An early `ensureSweepNow` may already have
    // collapsed the delay and run the sweep, in which case arming the timer anyway would just
    // schedule a redundant second sweep.
    if (this.startupSweepPending) {
      this.startupSweepTimer = setTimeout(() => {
        this.startupSweepTimer = undefined
        this.startupSweepPending = false
        this.requestSweep()
      }, STARTUP_SWEEP_DELAY_MS)
    }
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
        } else if (this.pendingDeliveryResweep) {
          // A list delivery arrived while this sweep was in flight: its measurements may predate
          // the path change the delivery signaled, so the owed trailing refresh runs once this
          // sweep's freshness window has passed.
          this.scheduleDeliveryResweep(this.deliveryResweepMinAgeMs)
        }
      })
  }

  private async sweepOnce() {
    const regions = this.regionList.getRegions()
    // An empty region list measures nothing, so sweeping it could only *erase*: it would replace
    // the table (and the persisted file) with `{}`, destroying the stale-hint value the persisted
    // entries exist for. And an empty list here usually isn't an operator retiring every region --
    // it's a list that simply hasn't loaded yet (app launch before the server delivers one).
    // Stale entries kept through an empty window are inert regardless: region auto-selection
    // filters candidates against the live server list, so an entry the eventual list doesn't name
    // can never win.
    if (regions.length === 0) {
      return
    }

    // A measuring sweep that begins now covers every delivery that arrived before it: it reads
    // the current list and probes over the current network path, so any owed trailing refresh --
    // pending flag or already-armed timer -- is discharged rather than left to run a redundant
    // sweep right after this one. A delivery arriving *during* this sweep re-arms the signal (see
    // `noteListDelivered`), which this sweep's completion then schedules.
    this.pendingDeliveryResweep = false
    if (this.deliveryResweepTimer) {
      clearTimeout(this.deliveryResweepTimer)
      this.deliveryResweepTimer = undefined
    }
    const measured = await Promise.all(
      regions.map(async (region, i) => {
        // Staggered, not simultaneous, so one region's ping traffic doesn't distort another's --
        // see `REGION_STAGGER_MS`.
        if (i > 0) {
          await delay(i * REGION_STAGGER_MS)
        }
        return [region.id, await this.measureRegion(region)] as const
      }),
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
    this.lastSweepFinishedAt = monotonicNow()

    // A region's entry is only ever replaced by a fresh object when it's actually re-measured
    // (see `kept` above); a failed measurement carries forward the exact same object reference.
    // So a shallow (per-region reference) comparison against what's on disk is a faithful "did
    // anything actually change" check here, not an approximation of a deeper one -- it can't be
    // fooled by an equal-but-recreated value, because unchanged regions are never recreated.
    if (!this.lastPersistedLatencies || !shallowEquals(latencies, this.lastPersistedLatencies)) {
      try {
        await savePersistedLatencies(await this.persistFilePath(), latencies)
        this.lastPersistedLatencies = latencies
      } catch (err: any) {
        log('error', `error persisting region latencies: ${err.stack ?? err}`).catch(() => {})
      }
    }

    this.emit('updated', latencies)
  }
}
