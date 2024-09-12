import RallyPointPlayer from 'rally-point-player'
import { singleton } from 'tsyringe'
import { isAbortError, raceAbort } from '../../common/async/abort-signals.js'
import { ResolvedRallyPointServer } from '../../common/rally-point/index.js'
import { EventMap, TypedEventEmitter } from '../../common/typed-emitter.js'
import logger from '../logger.js'
import { monotonicNow } from '../time/monotonic-now.js'

// Time until pings are considered "old" and recalculated when requested
const OUTDATED_PING_TIME = 30 * 60 * 1000
// NOTE(tec27): We take the median so this number should generally be odd
const PING_ATTEMPTS = 5
const TIME_BETWEEN_ATTEMPTS = 40
const TIME_JITTER = 25

interface PingResult {
  ping: number
  lastPinged: number
}

interface RallyPointManagerEvents extends EventMap {
  ping: (server: ResolvedRallyPointServer, ping: number) => void
}

function timeout(timeMillis: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, timeMillis))
}

@singleton()
export class RallyPointManager extends TypedEventEmitter<RallyPointManagerEvents> {
  private readonly rallyPoint = new RallyPointPlayer('::', 0)
  private readonly boundPromise = this.rallyPoint.bind()

  private servers = new Map<
    number,
    { server: ResolvedRallyPointServer; pingAbort: AbortController }
  >()
  private pingResults = new Map<number, PingResult>()

  /** Sets the server list for the manager. */
  setServers(servers: [id: number, server: ResolvedRallyPointServer][]) {
    this.pingResults.clear()
    for (const { pingAbort } of this.servers.values()) {
      pingAbort.abort()
    }
    this.servers.clear()

    for (const [id, server] of servers) {
      this.servers.set(id, { server, pingAbort: new AbortController() })
    }

    logger.info(`performed full update to rally-point server list: ${JSON.stringify(servers)}`)
  }

  upsertServer(server: ResolvedRallyPointServer) {
    let deletedPings = false
    if (this.servers.has(server.id)) {
      const { server: oldServer, pingAbort } = this.servers.get(server.id)!
      if (
        server.address4 !== oldServer.address4 ||
        server.address6 !== oldServer.address6 ||
        server.port !== oldServer.port
      ) {
        deletedPings = true
        pingAbort.abort()
        this.pingResults.delete(server.id)
      }
    }

    this.servers.set(server.id, { server, pingAbort: new AbortController() })

    logger.info(
      `upserted rally-point server: ${JSON.stringify(server)}, ` +
        `cleared cached pings: ${deletedPings}`,
    )
  }

  deleteServer(id: number) {
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
        }

        return true
      })
      .map(id => {
        const { server, pingAbort } = this.servers.get(id)!
        return [
          { id, address: server.address4!, port: server.port, abortSignal: pingAbort.signal },
          { id, address: server.address6!, port: server.port, abortSignal: pingAbort.signal },
        ].filter(s => !!s.address)
      })

    if (!needToPing.length) {
      return
    }

    await this.boundPromise

    for (const targets of needToPing) {
      const { id, abortSignal: signal } = targets[0]

      Promise.resolve()
        .then(async () => {
          // Randomize the start point for each server a bit as well just to spread things out
          await timeout(Math.random() * TIME_JITTER)

          const promises: Array<Promise<void>> = []
          const results: number[] = []

          for (let i = 0; i < PING_ATTEMPTS; i++) {
            if (signal.aborted) {
              return
            }
            const promise = this.rallyPoint
              .pingServers(targets.map(t => ({ address: t.address, port: t.port })))
              .then(r => {
                const successful = r.filter(r => r.time < Number.MAX_VALUE)
                for (const { time } of successful) {
                  results.push(time)
                }
              })
            promises.push(promise)

            const nextPingTime =
              TIME_BETWEEN_ATTEMPTS + Math.random() * 2 * TIME_JITTER - TIME_JITTER
            await timeout(nextPingTime)
          }

          try {
            await raceAbort(signal, Promise.all(promises))
          } catch (err) {
            if (isAbortError(err)) {
              return
            }
            throw err
          }

          if (!this.servers.has(id)) {
            return
          }
          const { server } = this.servers.get(id)!

          if (!results.length) {
            logger.verbose(`could not ping rally-point server [${id}, ${server.description}]`)
            return
          }

          // Sort the results and take the median
          results.sort((a, b) => a - b)
          const median = results[Math.floor(results.length / 2)]
          logger.verbose(
            `ping for rally-point server [${id}, ${server.description}]: ${JSON.stringify(
              results,
            )} => ${median}ms`,
          )
          this.emit('ping', server, median)
        })
        .catch(err => {
          logger.error(`error while pinging rally-point server ${id}: ${err.stack ?? err}`)
        })
    }
  }
}
