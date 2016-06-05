import { EventEmitter } from 'events'
import RallyPointPlayer from 'rally-point-player'

// Refresh interval has a random component to spread out server traffic if the server is  down
// for more than the normal interval and everyone reconnects at the same time
const REFRESH_INTERVAL = 20 * 60 * 1000 + (Math.random() * 5 * 60 * 1000)
class ServerEntry extends EventEmitter {
  constructor(rallyPoint, origin, { address6, address4, port }) {
    super()
    this.rallyPoint = rallyPoint
    this.origin = origin
    this.address6 = address6
    this.address4 = address4
    this.port = port
    this.refreshInterval = null
    this.lastPing = -1
  }

  refreshPing(forceRefresh = false) {
    if (forceRefresh || this.refreshInterval === null) {
      if (this.refreshInterval === null) {
        this.refreshInterval = setInterval(() => this.refreshPing(true), REFRESH_INTERVAL)
      }

      const promises = [ this.address6, this.address4 ]
        .filter(addr => !!addr) // remove undefined addresses
        .map(addr => this.rallyPoint.pingServers([{ address: addr, port: this.port }]))

      Promise.race(promises).then(([{ server, time }]) => {
        this.lastPing = time
        this.emit('ping', this, time)
      })
    } else if (this.lastPing > -1) {
      Promise.resolve().then(() => this.emit('ping', this, this.lastPing))
    }
  }

  close() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval)
      this.refreshInterval = null
    }
  }
}

function matchServer(server) {
  return s => s.address6 === server.address6 &&
      s.address4 === server.address4 &&
      server.port === s.port
}

export default class RallyPointManager extends EventEmitter {
  constructor() {
    super()
    this.rallyPoint = new RallyPointPlayer('::', 0)
    this.rallyPoint.bind()
    this._handlePing = ::this._onPing

    this.registrations = new Map()
    this.servers = new Map()
  }

  close() {
    for (const servers of this.servers.values()) {
      this._clearListenersAndClose(servers)
    }
    this.registrations.clear()
    this.servers.clear()

    this.rallyPoint.close()
  }

  registerOrigin(origin) {
    if (!this.registrations.has(origin)) {
      this.registrations.set(origin, 1)
      this.servers.set(origin, [])
    } else {
      this.registrations.set(origin, this.registrations.get(origin) + 1)
    }
  }

  unregisterOrigin(origin) {
    const count = this.registrations.get(origin)
    if (count <= 1) {
      const servers = this.servers.get(origin)
      this.servers.delete(origin)
      this.registrations.delete(origin)
      this._clearListenersAndClose(servers)
    } else {
      this.registrations.set(origin, count - 1)
    }
  }

  setServers(origin, servers) {
    const originServers = this.servers.get(origin)
    const matched = new Array(servers.length)
    for (let i = 0; i < servers.length && originServers.length; i++) {
      const server = servers[i]
      const index = originServers.findIndex(matchServer(server))
      if (index !== -1) {
        matched[i] = originServers[index]
        originServers.splice(index, 1)
      }
    }

    this._clearListenersAndClose(originServers)

    for (let i = 0; i < servers.length; i++) {
      if (!matched[i]) {
        matched[i] = new ServerEntry(this.rallyPoint, origin, servers[i])
        matched[i].on('ping', this._handlePing)
      }
    }

    originServers.splice(0, originServers.length, ...matched)
    for (const server of originServers) {
      server.refreshPing()
    }
  }

  _clearListenersAndClose(servers) {
    for (const server of servers) {
      server.removeListener('ping', this._handlePing)
      server.close()
    }
  }

  _onPing(server, ping) {
    if (!this.servers.has(server.origin)) return

    const servers = this.servers.get(server.origin)
    const index = servers.findIndex(matchServer(server))

    if (index !== -1) {
      this.emit('ping', server.origin, index, ping)
    }
  }
}
