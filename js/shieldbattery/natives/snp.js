const bindings = process._linkedBinding('shieldbattery_snp')

import dgram from 'dgram'
import { isIPv6 } from 'net'
import prettyBytes from 'pretty-bytes'
import log from '../logger'

let currentNetwork = null
export { currentNetwork }

// TODO(tec27): pass this in from C++?
const PACKET_SIZE = 576 - (60 + 8)

let _settings = {}
let _mappings = {}

export function setSettings(newSettings) {
  _settings = newSettings
}

export function setMappings(newMappings) {
  _mappings = newMappings
}

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
    // Always create an ipv6 socket (which should be fine on Vista+). If we need to send to ipv4
    // addresses, we convert them to their ipv6-mapped version (::ffff:<ip>)
    this.socket = dgram.createSocket('udp6')

    this.socket.on('message', (msg, rinfo) => this._onMessage(msg, rinfo))
      .on('listening', () => log.debug('Socket listening'))
      // TODO(tec27): do something better on errors
      .on('error', err => log.error('Socket error: ' + err))
    this.socket.bind(_settings.bwPort)
    this.mappings = Object.keys(_mappings).map(key => {
      const { port, address } = _mappings[key]
      return {
        port,
        address: isIPv6(address) ? address : `::ffff:${address}`,
      }
    })

    this.reverseMappings = Object.keys(this.mappings).reduce((result, key) => {
      const val = this.mappings[key]
      result[`${val.port}|${val.address}`] = key
    }, {})

    this.countersTimer = setInterval(() => this._logCounters(), 4 * 60 * 1000)
  }

  destroy() {
    log.debug('Network handler destroyed')
    currentNetwork = null
    this.socket.close()
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

      this.socket.send(packet, 0, packet.length, t.port, t.address)
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
        `${prettyBytes(c.bytesSent)} sent, ${prettyBytes(c.bytesReceived)} received, ` +
        `${c.overLengthPackets} over length, ${c.unmappedSends} unmapped sends, ` +
        `${c.unmappedReceives} unmapped receives`)
  }
}

bindings.init = (onReceive, handle) => {
  currentNetwork = new NetworkHandler((msg, address) => onReceive(handle, msg, address))
  return currentNetwork
}
