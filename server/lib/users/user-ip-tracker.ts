import { container, instanceCachingFactory, singleton } from 'tsyringe'
import { SbUserId } from '../../../common/users/sb-user-id'
import log from '../logging/logger'
import type { UpsertUserIp } from '../network/user-ips-type'
import { Clock, TimeoutId } from '../time/clock'
import { upsertUserIpSightings, UserIpSighting } from './user-ips'

/** How long repeat sightings of a user at an address build up before they are written together. */
export const USER_IP_WRITE_INTERVAL_MS = 60 * 1000

interface TrackedAddress {
  userId: SbUserId
  ipAddress: string
  /** Sightings since the last write that included this address. */
  unwritten: number
  lastSeen: number
}

/**
 * Records which IP addresses users are seen at, without a database write per sighting. Every
 * authenticated request and socket connection is a sighting, so writing each one makes this the
 * busiest table in the database.
 *
 * The first sighting of a user at an address is written immediately, so that anything comparing
 * users by address sees it right away. Later ones only count up in memory, and all of those counts
 * go out in one statement per interval. A user and address that go a whole interval without a
 * sighting are forgotten, which makes their next sighting a first one again.
 *
 * Counts that haven't been written yet are lost if the process exits.
 */
@singleton()
export class UserIpTracker {
  private tracked = new Map<string, TrackedAddress>()
  private writeTimer: TimeoutId | undefined

  constructor(private clock: Clock) {}

  record(userId: SbUserId, ipAddress: string): void {
    const now = this.clock.now()
    const key = `${userId}|${ipAddress}`
    const existing = this.tracked.get(key)
    if (existing) {
      existing.unwritten += 1
      existing.lastSeen = now
      return
    }

    this.tracked.set(key, { userId, ipAddress, unwritten: 0, lastSeen: now })
    this.write([{ userId, ipAddress, count: 1, lastSeen: new Date(now) }])
    this.writeTimer ??= this.clock.setTimeout(
      () => this.writeUnwritten(),
      USER_IP_WRITE_INTERVAL_MS,
    )
  }

  private writeUnwritten() {
    this.writeTimer = undefined

    const sightings: UserIpSighting[] = []
    for (const [key, entry] of this.tracked) {
      if (entry.unwritten === 0) {
        this.tracked.delete(key)
      } else {
        sightings.push({
          userId: entry.userId,
          ipAddress: entry.ipAddress,
          count: entry.unwritten,
          lastSeen: new Date(entry.lastSeen),
        })
        entry.unwritten = 0
      }
    }

    if (this.tracked.size > 0) {
      this.writeTimer = this.clock.setTimeout(
        () => this.writeUnwritten(),
        USER_IP_WRITE_INTERVAL_MS,
      )
    }
    if (sightings.length > 0) {
      this.write(sightings)
    }
  }

  /**
   * Writes sightings without waiting for the result. A failed write is logged and its counts are
   * dropped rather than retried: one bad row fails the whole statement, and carrying it into the
   * next one would fail that too.
   */
  private write(sightings: UserIpSighting[]) {
    upsertUserIpSightings(sightings).catch((err: unknown) => {
      log.error({ err }, 'error saving user IP addresses')
    })
  }
}

container.register<UpsertUserIp>('upsertUserIp', {
  useFactory: instanceCachingFactory<UpsertUserIp>(c => {
    const tracker = c.resolve(UserIpTracker)
    return async (userId, ipAddress) => tracker.record(userId, ipAddress)
  }),
})
