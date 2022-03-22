import RallyPointPlayer from 'rally-point-player'
import { singleton } from 'tsyringe'
import { ResolvedRallyPointServer } from '../../common/rally-point'
import { EventMap, TypedEventEmitter } from '../../common/typed-emitter'
import logger from '../logger'
import { monotonicNow } from '../time/monotonic-now'

// Time until pings are considered "old" and recalculated when requested
const OUTDATED_PING_TIME = 5 * 60 * 1000
const PING_RETRIES = 3

interface OutstandingPing {
  promise: Promise<unknown>
  pingedAt: number
}

interface PingResult {
  ping: number
  lastPinged: number
}

interface RallyPointManagerEvents extends EventMap {
  ping: (server: ResolvedRallyPointServer, ping: number) => void
}

@singleton()
export class RallyPointManager extends TypedEventEmitter<RallyPointManagerEvents> {
  private readonly rallyPoint = new RallyPointPlayer('::', 0)
  private readonly boundPromise = this.rallyPoint.bind()

  private servers = new Map<number, ResolvedRallyPointServer>()
  private outstandingPings = new Map<number, OutstandingPing>()
  private pingResults = new Map<number, PingResult>()

  /** Sets the server list for the manager */
  setServers(servers: [id: number, server: ResolvedRallyPointServer][]) {
    this.outstandingPings.clear()
    this.pingResults.clear()
    this.servers.clear()

    for (const [id, server] of servers) {
      this.servers.set(id, server)
    }

    logger.info(`performed full update to rally-point server list: ${JSON.stringify(servers)}`)
  }

  upsertServer(server: ResolvedRallyPointServer) {
    let deletedPings = false
    if (this.servers.has(server.id)) {
      const oldServer = this.servers.get(server.id)!
      if (
        server.address4 !== oldServer.address4 ||
        server.address6 !== oldServer.address6 ||
        server.port !== oldServer.port
      ) {
        deletedPings = true
        this.outstandingPings.delete(server.id)
        this.pingResults.delete(server.id)
      }
    }

    this.servers.set(server.id, server)

    logger.info(
      `upserted rally-point server: ${JSON.stringify(server)}, ` +
        `cleared cached pings: ${deletedPings}`,
    )
  }

  deleteServer(id: number) {
    this.outstandingPings.delete(id)
    this.pingResults.delete(id)

    if (this.servers.has(id)) {
      logger.info(`removed rally-point server: ${JSON.stringify(this.servers.get(id))}`)
      this.servers.delete(id)
    }
  }

  refreshPings() {
    this.refreshPingsInternal().catch(err => {
      logger.error(`error when refreshing rally-point pings: ${err.stack ?? err}`)
    })
  }

  private async refreshPingsInternal() {
    const requestTime = monotonicNow()

    const needToPing = Array.from(this.servers.keys())
      .filter(id => {
        if (
          this.pingResults.has(id) &&
          requestTime - this.pingResults.get(id)!.lastPinged < OUTDATED_PING_TIME
        ) {
          return false
        } else if (
          this.outstandingPings.has(id) &&
          requestTime - this.outstandingPings.get(id)!.pingedAt < OUTDATED_PING_TIME
        ) {
          return false
        }

        return true
      })
      .map(id => {
        const server = this.servers.get(id)!
        return [
          { id, address: server.address4!, port: server.port },
          { id, address: server.address6!, port: server.port },
        ].filter(s => !!s.address)
      })

    if (!needToPing.length) {
      return
    }

    await this.boundPromise

    for (const targets of needToPing) {
      const id = targets[0].id
      let tries = 0

      const doIt = () => {
        tries += 1

        const pingedAt = monotonicNow()
        const promise = this.rallyPoint.pingServers(
          targets.map(t => ({ address: t.address, port: t.port })),
        )
        this.outstandingPings.set(id, { promise, pingedAt })

        promise
          .then(results => {
            if (this.outstandingPings.get(id)?.promise !== promise) {
              // A newer ping request is in progress, ignore this result
              return
            }

            let minPing = Number.MAX_VALUE
            for (const r of results) {
              if (r.time < minPing) {
                minPing = r.time
              }
            }

            if (minPing === Number.MAX_VALUE && tries < PING_RETRIES) {
              doIt()
            } else {
              this.pingResults.set(id, { ping: minPing, lastPinged: pingedAt })
              this.outstandingPings.delete(id)

              const server = this.servers.get(id)!
              logger.verbose(
                `ping for rally-point server [${id}, ${server.description}]: ${minPing}ms`,
              )

              this.emit('ping', server, minPing)
            }
          })
          .catch(err => {
            logger.error(`error while pinging rally-point server ${id}: ${err.stack ?? err}`)
          })
      }

      doIt()
    }
  }
}
