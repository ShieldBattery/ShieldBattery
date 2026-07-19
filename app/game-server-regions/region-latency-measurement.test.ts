import dgram from 'node:dgram'
import net from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { makeGameServerRegionId } from '../../common/game-server-regions'
import {
  measureBeaconMedianRtt,
  measureFallbackMedianRtt,
  measureRegionLatency,
} from './region-latency-measurement'

const FAST_OPTIONS = { attempts: 3, attemptTimeoutMs: 200, attemptSpacingMs: 20 }

interface UdpEcho {
  port: number
  close: () => Promise<void>
}

/** Starts a loopback UDP echo server: whatever it receives, it sends back verbatim. */
function startUdpEcho(delayMs = 0, corrupt = false): Promise<UdpEcho> {
  const socket = dgram.createSocket('udp4')
  socket.on('message', (msg, rinfo) => {
    const reply = corrupt ? Buffer.concat([msg.subarray(1), Buffer.from([0])]) : msg
    setTimeout(() => socket.send(reply, rinfo.port, rinfo.address), delayMs)
  })
  return new Promise(resolve => {
    socket.bind(0, '127.0.0.1', () => {
      const address = socket.address()
      resolve({
        port: address.port,
        close: () => new Promise<void>(res => socket.close(() => res())),
      })
    })
  })
}

interface TcpAcceptClose {
  port: number
  close: () => Promise<void>
}

/** Starts a loopback TCP listener that accepts a connection and immediately closes it. */
function startTcpAcceptClose(): Promise<TcpAcceptClose> {
  const server = net.createServer(socket => socket.destroy())
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        throw new Error('Expected an AddressInfo')
      }
      resolve({
        port: address.port,
        close: () => new Promise<void>(res => server.close(() => res())),
      })
    })
  })
}

/** Reserves a loopback UDP port and immediately frees it, so nothing is listening there. */
async function getDeadUdpPort(): Promise<number> {
  const socket = dgram.createSocket('udp4')
  const port = await new Promise<number>(resolve => {
    socket.bind(0, '127.0.0.1', () => {
      const address = socket.address()
      resolve(address.port)
    })
  })
  await new Promise<void>(resolve => socket.close(() => resolve()))
  return port
}

describe('measureBeaconMedianRtt', () => {
  let echo: UdpEcho | undefined

  afterEach(async () => {
    await echo?.close()
    echo = undefined
  })

  it('returns the median RTT across successful attempts', async () => {
    echo = await startUdpEcho(20)

    const rtt = await measureBeaconMedianRtt(`127.0.0.1:${echo.port}`, FAST_OPTIONS)

    expect(rtt).toBeDefined()
    expect(rtt!).toBeGreaterThanOrEqual(15)
    expect(rtt!).toBeLessThan(500)
  })

  it('ignores replies whose payload does not match the sent nonce', async () => {
    echo = await startUdpEcho(0, true /* corrupt */)

    const rtt = await measureBeaconMedianRtt(`127.0.0.1:${echo.port}`, FAST_OPTIONS)

    expect(rtt).toBeUndefined()
  })

  it('returns undefined when nothing responds', async () => {
    const deadPort = await getDeadUdpPort()

    const rtt = await measureBeaconMedianRtt(`127.0.0.1:${deadPort}`, FAST_OPTIONS)

    expect(rtt).toBeUndefined()
  })
})

describe('measureFallbackMedianRtt', () => {
  let tcp: TcpAcceptClose | undefined

  afterEach(async () => {
    await tcp?.close()
    tcp = undefined
  })

  it('returns the median TCP-connect time', async () => {
    tcp = await startTcpAcceptClose()

    const rtt = await measureFallbackMedianRtt(`127.0.0.1:${tcp.port}`, FAST_OPTIONS)

    expect(rtt).toBeDefined()
    expect(rtt!).toBeGreaterThanOrEqual(0)
    expect(rtt!).toBeLessThan(500)
  })

  it('returns undefined when nothing is listening', async () => {
    const deadPort = await getDeadUdpPort()

    const rtt = await measureFallbackMedianRtt(`127.0.0.1:${deadPort}`, FAST_OPTIONS)

    expect(rtt).toBeUndefined()
  })
})

describe('measureRegionLatency', () => {
  let echo: UdpEcho | undefined
  let tcp: TcpAcceptClose | undefined

  afterEach(async () => {
    await echo?.close()
    await tcp?.close()
    echo = undefined
    tcp = undefined
  })

  it('prefers the beacon when it succeeds', async () => {
    echo = await startUdpEcho(10)
    tcp = await startTcpAcceptClose()

    const result = await measureRegionLatency(
      {
        id: makeGameServerRegionId('test-region'),
        displayName: 'Test Region',
        beacon: `127.0.0.1:${echo.port}`,
        fallback: `127.0.0.1:${tcp.port}`,
      },
      FAST_OPTIONS,
    )

    expect(result?.source).toBe('beacon')
    expect(result?.rttMs).toBeGreaterThanOrEqual(0)
  })

  it('falls back to TCP-connect time when every beacon attempt fails', async () => {
    const deadBeaconPort = await getDeadUdpPort()
    tcp = await startTcpAcceptClose()

    const result = await measureRegionLatency(
      {
        id: makeGameServerRegionId('test-region'),
        displayName: 'Test Region',
        beacon: `127.0.0.1:${deadBeaconPort}`,
        fallback: `127.0.0.1:${tcp.port}`,
      },
      FAST_OPTIONS,
    )

    expect(result?.source).toBe('fallback')
    expect(result?.rttMs).toBeGreaterThanOrEqual(0)
  })

  it('returns undefined when both the beacon and the fallback are dead', async () => {
    const deadBeaconPort = await getDeadUdpPort()
    const deadFallbackPort = await getDeadUdpPort()

    const result = await measureRegionLatency(
      {
        id: makeGameServerRegionId('test-region'),
        displayName: 'Test Region',
        beacon: `127.0.0.1:${deadBeaconPort}`,
        fallback: `127.0.0.1:${deadFallbackPort}`,
      },
      FAST_OPTIONS,
    )

    expect(result).toBeUndefined()
  })
})
