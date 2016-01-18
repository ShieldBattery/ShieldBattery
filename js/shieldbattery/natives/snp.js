const bindings = process._linkedBinding('shieldbattery_snp')

import dgram from 'dgram'
import log from '../logger'

// TODO(tec27): get this from psi
const settings = {
  bwPort: 6112,
}

let currentNetwork = null
export { currentNetwork }

// TODO(tec27): pass this in from C++?
const PACKET_SIZE = 576 - (60 + 8)

class NetworkHandler {
  constructor(onReceive) {
    log.debug('Network handler constructed')
    this.onReceive = onReceive
    this.counters = {
      overLengthPackets: 0,
      unmappedSends: 0,
      unmappedReceives: 0,
      bytesSent: 0,
      bytesReceived: 0,
    }
    // TODO(tec27): only create 4/6 if we need them (e.g. only if we have an address of that type)
    this.socket4 = dgram.createSocket('udp4')
    this.socket6 = dgram.createSocket('udp6')

    this.socket4.on('message', (msg, rinfo) => this._onMessage(msg, rinfo))
    this.socket6.on('message', (msg, rinfo) => this._onMessage(msg, rinfo))

    this.socket4.bind(settings.bwPort)
    this.socket6.bind(settings.bwPort)

    // TODO(tec27): get this from psi
    this.mappings = {
      // TODO(tec27): this first one should *always* be the host
      '10.27.27.0': { port: 6112, address: '127.0.0.1' },
      '10.27.27.1': { port: 6112, address: '127.0.0.1' },
      '10.27.27.2': { port: 6112, address: '127.0.0.1' },
      '10.27.27.3': { port: 6112, address: '127.0.0.1' },
      '10.27.27.4': { port: 6112, address: '127.0.0.1' },
      '10.27.27.5': { port: 6112, address: '127.0.0.1' },
      '10.27.27.6': { port: 6112, address: '127.0.0.1' },
      '10.27.27.7': { port: 6112, address: '127.0.0.1' },
    }
    this.reverseMappings = Object.keys(this.mappings).reduce((result, key) => {
      const val = this.mappings[key]
      result[`${val.port}|${val.address}`] = key
    }, {})

    this.countersTimer = setInterval(() => this._logCounters(), 4 * 60 * 1000)
  }

  destroy() {
    log.debug('Network handler destroyed')
    currentNetwork = null
    this.socket4.close()
    this.socket6.close()
    clearInterval(this.countersTimer)
    this._logCounters()
  }

  send(targets, packet) {
    const mapped = targets.map(t => this.mappings[t])
    for (const t of mapped) {
      if (!t) {
        this.counters.unmappedSends++
        continue
      }

      if (t.v6) {
        this.socket6.send(packet, 0, packet.length, t.port, t.address)
      } else {
        this.socket4.send(packet, 0, packet.length, t.port, t.address)
      }
      this.counters.bytesSent += packet.length
    }
  }

  _onMessage(msg, rinfo) {
    if (msg.length > PACKET_SIZE) {
      this.counters.overLengthPackets++
      return
    }

    const mapped = this.reverseMappings[`${rinfo.port}|${rinfo.address}`]
    if (!mapped) {
      this.counters.unmappedReceives++
      return
    }
    this.onReceive(msg, mapped)
    this.counters.receivedBytes += msg.length
  }

  _logCounters() {
    const c = this.counters
    log.debug('Network handler counters: ' +
        `${c.bytesSent} bytes sent, ${c.bytesReceived} bytes received, ` +
        `${c.overLengthPackets} over length, ${c.unmappedSends} unmapped sends, ` +
        `${c.unmappedReceives} unmapped receives`)
  }
}

bindings.init = (onReceive, handle) => {
  currentNetwork = new NetworkHandler((msg, address) => onReceive(handle, msg, address))
  return currentNetwork
}
