const bindings = process._linkedBinding('shieldbattery_snp')

import prettyBytes from 'pretty-bytes'
import log from '../logger'

let currentNetwork = null
export { currentNetwork }

// TODO(tec27): pass this in from C++?
const PACKET_SIZE = 576 - 13 - (60 + 8)

let _rallyPoint = {}
let _routes = {}

export function setRallyPoint(newRallyPoint) {
  _rallyPoint = newRallyPoint
}

export function setNetworkRoutes(newRoutes) {
  _routes = newRoutes
  if (currentNetwork) {
    currentNetwork.updateRoutes()
  }
}

class NetworkHandler {
  constructor(onReceive) {
    log.debug('Network handler constructed')
    this.onReceive = onReceive
    this.counters = {
      overLengthPackets: 0,
      unmappedSends: 0,
      bytesSent: 0,
      bytesReceived: 0,
    }
    this.rallyPoint = _rallyPoint

    this.mappings = {}

    this.countersTimer = setInterval(() => this._logCounters(), 4 * 60 * 1000)
    // TODO(tec27): Figure out wtf is going on with the queuing and remove this
    this.reallyDumbTimer = setInterval(() => {}, 50)
  }

  destroy() {
    log.debug('Network handler destroyed')
    currentNetwork = null
    this.rallyPoint.close()
    clearInterval(this.reallyDumbTimer)
    clearInterval(this.countersTimer)
    this._logCounters()
  }

  updateRoutes() {
    this.mappings = _routes
    Object.keys(_routes).forEach(ip => {
      const route = _routes[ip]
      if (!route) {
        // This is our own route
        return
      }
      route.on('message', (data, route) => this._onMessage(data, ip))
    })
    log.debug('Network routes updated')
  }

  send(targets, packet) {
    const mapped = targets.map(t => this.mappings[t])
    for (const route of mapped) {
      if (!route) {
        this.counters.unmappedSends++
        continue
      }

      route.send(packet)
      this.counters.bytesSent += packet.length
    }
  }

  _onMessage(msg, ip) {
    if (msg.length > PACKET_SIZE) {
      this.counters.overLengthPackets++
      return
    }

    this.onReceive(msg, ip)
    this.counters.bytesReceived += msg.length
  }

  _logCounters() {
    const c = this.counters
    log.debug('Network handler counters: ' +
        `${prettyBytes(c.bytesSent)} sent, ${prettyBytes(c.bytesReceived)} received, ` +
        `${c.overLengthPackets} over length, ${c.unmappedSends} unmapped sends`)
  }
}

bindings.init = (onReceive, handle) => {
  currentNetwork = new NetworkHandler((msg, address) => onReceive(handle, msg, address))
  return currentNetwork
}
