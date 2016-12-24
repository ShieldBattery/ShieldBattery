import createDeferred from '../../../common/async/deferred'

class PingRegistry {
  constructor() {
    this.servers = []
    this.pings = new Map()
    this.promises = new Map()
  }

  setServers(servers) {
    this.servers = servers.slice()
  }

  addPing(userName, serverIndex, ping) {
    if (!this.pings.has(userName)) {
      this.pings.set(userName, new Array(this.servers.length))
    }
    if (!this.promises.has(userName)) {
      this.promises.set(userName, createDeferred())
    }

    const userPings = this.pings.get(userName)
    userPings[serverIndex] = ping
    this.promises.get(userName).resolve()
  }

  clearPings(userName) {
    this.pings.delete(userName)
    if (this.promises.has(userName)) {
      this.promises.get(userName).reject(new Error('User was removed'))
      this.promises.delete(userName)
    }
  }

  getPings(userName) {
    return this.pings.get(userName) || new Array(this.servers.length)
  }

  // Waits until the registry has at least one ping result for the user
  async waitForPingResult(userName) {
    if (!this.promises.has(userName)) {
      this.promises.set(userName, createDeferred())
    }

    await this.promises.get(userName)
  }
}

export default new PingRegistry()
