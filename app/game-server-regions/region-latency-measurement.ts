import crypto from 'node:crypto'
import dgram from 'node:dgram'
import { lookup } from 'node:dns/promises'
import net from 'node:net'
import { GameServerRegion, RegionLatency } from '../../common/game-server-regions'
import { monotonicNow } from '../time/monotonic-now'

// This module deliberately avoids the app's shared logger: it initializes eagerly against a real
// Electron process, which makes anything that statically imports it unloadable under plain Node.
// Routine measurement failures are reported through return values; only genuinely unexpected
// errors are logged, straight to the console.

// NOTE: We take the median, so this should generally be odd.
export const BEACON_PING_ATTEMPTS = 5
// Beacons rate-limit to ~3 datagrams/sec per sender.
export const BEACON_ATTEMPT_SPACING_MS = 400
export const FALLBACK_PING_ATTEMPTS = 3
export const ATTEMPT_TIMEOUT_MS = 2000

export interface MeasureOptions {
  attempts?: number
  attemptTimeoutMs?: number
  /** Minimum spacing between beacon attempts. Ignored by the TCP-connect fallback. */
  attemptSpacingMs?: number
  signal?: AbortSignal
}

function delay(millis: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, millis))
}

function median(values: number[]): number | undefined {
  if (!values.length) {
    return undefined
  }
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function splitHostPort(hostPort: string): { host: string; port: number } {
  const idx = hostPort.lastIndexOf(':')
  if (idx === -1) {
    throw new Error(`Invalid host:port value: ${hostPort}`)
  }
  let host = hostPort.slice(0, idx)
  // A bracketed IPv6 literal ("[::1]:20000") carries the brackets only to delimit the address
  // from the port; dns.lookup/net.connect want the bare address.
  if (host.startsWith('[') && host.endsWith(']')) {
    host = host.slice(1, -1)
  }
  return { host, port: Number(hostPort.slice(idx + 1)) }
}

/**
 * Sends one nonce-carrying datagram to `address:port` on `socket` and waits for it to be echoed
 * back verbatim. Replies that don't match the nonce we just sent (e.g. a late reply to a previous,
 * already-timed-out attempt) are ignored rather than accepted.
 */
function pingBeaconOnce(
  socket: dgram.Socket,
  address: string,
  port: number,
  timeoutMillis: number,
  signal?: AbortSignal,
): Promise<number | undefined> {
  const nonce = crypto.randomBytes(8)
  const sentAt = monotonicNow()

  return new Promise<number | undefined>(resolve => {
    let settled = false

    const cleanup = () => {
      clearTimeout(timer)
      socket.off('message', onMessage)
      signal?.removeEventListener('abort', onAbort)
    }
    const finish = (result: number | undefined) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      resolve(result)
    }
    const onMessage = (msg: Buffer) => {
      if (msg.equals(nonce)) {
        finish(monotonicNow() - sentAt)
      }
    }
    const onAbort = () => finish(undefined)

    const timer = setTimeout(() => finish(undefined), timeoutMillis)
    socket.on('message', onMessage)
    signal?.addEventListener('abort', onAbort)

    socket.send(nonce, port, address, err => {
      if (err) {
        finish(undefined)
      }
    })
  })
}

/**
 * Measures the median round-trip time to a UDP ping beacon across several attempts, spaced apart
 * to respect the beacon's per-sender rate limit.
 */
export async function measureBeaconMedianRtt(
  beaconHostPort: string,
  options: MeasureOptions = {},
): Promise<number | undefined> {
  const {
    attempts = BEACON_PING_ATTEMPTS,
    attemptTimeoutMs = ATTEMPT_TIMEOUT_MS,
    attemptSpacingMs = BEACON_ATTEMPT_SPACING_MS,
    signal,
  } = options
  const { host, port } = splitHostPort(beaconHostPort)
  const { address, family } = await lookup(host)

  const socket = dgram.createSocket(family === 6 ? 'udp6' : 'udp4')
  // A send to an unreachable beacon can surface as an async socket error (e.g. ECONNREFUSED from
  // an ICMP port-unreachable reply) rather than simply going unanswered. Left unhandled, an
  // 'error' event on an EventEmitter throws; treating it as informational keeps the affected
  // attempt as a plain timeout instead of crashing the process.
  socket.on('error', () => {})

  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject)
      socket.bind(() => {
        socket.off('error', reject)
        resolve()
      })
    })

    const results: number[] = []
    for (let i = 0; i < attempts; i++) {
      if (signal?.aborted) {
        break
      }

      const attemptStart = monotonicNow()
      const rtt = await pingBeaconOnce(socket, address, port, attemptTimeoutMs, signal)
      if (rtt !== undefined) {
        results.push(rtt)
      }

      const elapsed = monotonicNow() - attemptStart
      if (i < attempts - 1 && elapsed < attemptSpacingMs) {
        await delay(attemptSpacingMs - elapsed)
      }
    }

    return median(results)
  } finally {
    socket.close()
  }
}

function measureTcpConnectOnce(
  host: string,
  port: number,
  timeoutMillis: number,
  signal?: AbortSignal,
): Promise<number | undefined> {
  const start = monotonicNow()

  return new Promise<number | undefined>(resolve => {
    let settled = false

    const socket = net.connect({ host, port })

    const cleanup = () => {
      clearTimeout(timer)
      socket.off('connect', onConnect)
      socket.off('error', onError)
      signal?.removeEventListener('abort', onAbort)
    }
    const finish = (result: number | undefined) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      socket.destroy()
      resolve(result)
    }
    const onConnect = () => finish(monotonicNow() - start)
    const onError = () => finish(undefined)
    const onAbort = () => finish(undefined)

    const timer = setTimeout(() => finish(undefined), timeoutMillis)
    socket.once('connect', onConnect)
    socket.once('error', onError)
    signal?.addEventListener('abort', onAbort)
  })
}

/**
 * Measures the median TCP-connect handshake time to a fallback endpoint across several attempts.
 * Only used to rank regions, so TCP-vs-UDP skew against `measureBeaconMedianRtt` is acceptable.
 */
export async function measureFallbackMedianRtt(
  fallbackHostPort: string,
  options: MeasureOptions = {},
): Promise<number | undefined> {
  const {
    attempts = FALLBACK_PING_ATTEMPTS,
    attemptTimeoutMs = ATTEMPT_TIMEOUT_MS,
    signal,
  } = options
  const { host, port } = splitHostPort(fallbackHostPort)

  const results: number[] = []
  for (let i = 0; i < attempts; i++) {
    if (signal?.aborted) {
      break
    }
    const rtt = await measureTcpConnectOnce(host, port, attemptTimeoutMs, signal)
    if (rtt !== undefined) {
      results.push(rtt)
    }
  }

  return median(results)
}

/**
 * Measures one region's latency: the UDP beacon first, falling back to the TCP-connect endpoint
 * only if every beacon attempt failed. Returns `undefined` if both paths failed.
 */
export async function measureRegionLatency(
  region: GameServerRegion,
  options: MeasureOptions = {},
): Promise<RegionLatency | undefined> {
  let beaconRtt: number | undefined
  try {
    beaconRtt = await measureBeaconMedianRtt(region.beacon, options)
  } catch (err: any) {
    console.error(`beacon measurement failed for region [${region.id}]: ${err.stack ?? err}`)
  }
  if (beaconRtt !== undefined) {
    return { regionId: region.id, rttMs: beaconRtt, source: 'beacon', measuredAt: Date.now() }
  }

  let fallbackRtt: number | undefined
  try {
    fallbackRtt = await measureFallbackMedianRtt(region.fallback, options)
  } catch (err: any) {
    console.error(`fallback measurement failed for region [${region.id}]: ${err.stack ?? err}`)
  }
  if (fallbackRtt !== undefined) {
    return { regionId: region.id, rttMs: fallbackRtt, source: 'fallback', measuredAt: Date.now() }
  }

  return undefined
}
