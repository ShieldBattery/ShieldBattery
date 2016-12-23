import { EventEmitter } from 'events'
import RallyPointPlayer from 'rally-point-player'

// Time until pings are considered "old" and re-calculated when requested
const OUTDATED_PING_TIME = 2 * 60 * 1000
const PING_RETRIES = 3
class ServerEntry extends EventEmitter {
  constructor(rallyPoint, origin, { desc, address6, address4, port }) {
    super()
    this.rallyPoint = rallyPoint
    this.desc = desc
    this.origin = origin
    this.address6 = address6
    this.address4 = address4
    this.port = port
    this.lastPingDate = -1
    this.lastPing = -1
  }

  refreshPing() {
    const curDate = Date.now()
    // curDate < lastPingDate handles the case that clock has been set backwards since we last
    // checked
    if (curDate < this.lastPingDate || curDate - this.lastPingDate > OUTDATED_PING_TIME) {
      this.lastPingDate = curDate
      let tries = PING_RETRIES
      const doTry = () => {
        tries--
        const promises = [ this.address6, this.address4 ]
          .filter(addr => !!addr) // remove undefined addresses
          .map(addr => this.rallyPoint.pingServers([{ address: addr, port: this.port }]))

        Promise.race(promises).then(([{ server, time }]) => {
          if (time === Number.MAX_VALUE && tries > 0) {
            doTry()
            return
          }

          this.lastPing = time
          this.emit('ping', this, time)
        })
      }

      doTry()
    } else if (this.lastPing > -1) {
      Promise.resolve().then(() => this.emit('ping', this, this.lastPing))
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
      this._clearListeners(servers)
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
      this._clearListeners(servers)
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

    this._clearListeners(originServers)

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

  refreshPingsForOrigin(origin) {
    const originServers = this.servers.get(origin)
    for (const server of originServers) {
      server.refreshPing()
    }
  }

  _clearListeners(servers) {
    for (const server of servers) {
      server.removeListener('ping', this._handlePing)
    }
  }

  _onPing(server, ping) {
    if (!this.servers.has(server.origin)) return

    const servers = this.servers.get(server.origin)
    const index = servers.findIndex(matchServer(server))

    if (index !== -1) {
      this.emit('ping', server.origin, index, servers[index].desc, ping)
    }
  }
}
