import { EventEmitter } from 'events'
import RallyPointPlayer from 'rally-point-player'

// Time until pings are considered "old" and re-calculated when requested
const OUTDATED_PING_TIME = 2 * 60 * 1000
const PING_RETRIES = 3
class ServerEntry extends EventEmitter {
  constructor(rallyPoint, { desc, address6, address4, port }) {
    super()
    this.rallyPoint = rallyPoint
    this.desc = desc
    this.address6 = address6
    this.address4 = address4
    this.port = port
    this.lastPingDate = -1
    this.lastPing = -1
  }

  async refreshPing() {
    const curDate = Date.now()
    // curDate < lastPingDate handles the case that clock has been set backwards since we last
    // checked
    if (curDate < this.lastPingDate || curDate - this.lastPingDate > OUTDATED_PING_TIME) {
      await this.rallyPoint._boundPromise
      this.lastPingDate = curDate
      let tries = PING_RETRIES
      const doTry = () => {
        tries--
        const promises = [this.address6, this.address4]
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
  return s =>
    s.address6 === server.address6 && s.address4 === server.address4 && server.port === s.port
}

export default class RallyPointManager extends EventEmitter {
  constructor() {
    super()
    this.rallyPoint = new RallyPointPlayer('::', 0)
    this._handlePing = ::this._onPing
    this._boundPromise = this.rallyPoint.bind()

    this.servers = []
  }

  close() {
    this._clearListeners(this.servers)
    this.servers.length = 0
    this.rallyPoint.close()
  }

  setServers(servers) {
    const matched = new Array(servers.length)
    for (let i = 0; i < servers.length && this.servers.length; i++) {
      const server = servers[i]
      const index = this.servers.findIndex(matchServer(server))
      if (index !== -1) {
        matched[i] = this.servers[index]
        this.servers.splice(index, 1)
      }
    }

    this._clearListeners(this.servers)

    for (let i = 0; i < servers.length; i++) {
      if (!matched[i]) {
        matched[i] = new ServerEntry(this.rallyPoint, servers[i])
        matched[i].on('ping', this._handlePing)
      }
    }

    this.servers.splice(0, this.servers.length, ...matched)
    for (const server of this.servers) {
      server.refreshPing()
    }
  }

  async refreshPings() {
    await this._boundPromise
    for (const server of this.servers) {
      server.refreshPing()
    }
  }

  _clearListeners(servers) {
    for (const server of servers) {
      server.removeListener('ping', this._handlePing)
    }
  }

  _onPing(server, ping) {
    const index = this.servers.findIndex(matchServer(server))

    if (index !== -1) {
      this.emit('ping', index, this.servers[index].desc, ping)
    }
  }
}
