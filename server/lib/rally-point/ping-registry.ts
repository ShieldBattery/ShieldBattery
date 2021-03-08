import createDeferred, { Deferred } from '../../../common/async/deferred'

export interface RallyPointServer {
  address4: string | undefined
  address6: string | undefined
  port: number
  desc: string
}

export class PingRegistry {
  private _servers: RallyPointServer[] = []
  private pings = new Map<string, number[]>()
  private promises = new Map<string, Deferred<void>>()

  get servers(): ReadonlyArray<Readonly<RallyPointServer>> {
    return this._servers
  }

  setServers(servers: RallyPointServer[]) {
    this._servers = servers.slice()
  }

  addPing(userName: string, serverIndex: number, ping: number) {
    if (!this.pings.has(userName)) {
      this.pings.set(userName, new Array(this.servers.length))
    }
    if (!this.promises.has(userName)) {
      this.promises.set(userName, createDeferred())
    }

    const userPings = this.pings.get(userName)!
    userPings[serverIndex] = ping
    this.promises.get(userName)?.resolve()
  }

  clearPings(userName: string) {
    this.pings.delete(userName)

    this.promises.get(userName)?.reject(new Error('User was removed'))
    this.promises.delete(userName)
  }

  getPings(userName: string) {
    return this.pings.get(userName) || new Array(this.servers.length)
  }

  // Waits until the registry has at least one ping result for the user
  async waitForPingResult(userName: string) {
    if (!this.promises.has(userName)) {
      this.promises.set(userName, createDeferred())
    }

    await this.promises.get(userName)!
  }
}

export default new PingRegistry()
