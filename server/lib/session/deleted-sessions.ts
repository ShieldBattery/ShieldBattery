import { singleton } from 'tsyringe'
import swallowNonBuiltins from '../../../common/async/swallow-non-builtins'
import { Redis } from '../redis/redis'

// TODO(tec27): We probably need to broadcast these to the Rust server as well

/**
 * Tracks sessions that have been recently deleted so that we don't refresh them in requests being
 * processed in parallel.
 */
@singleton()
export class DeletedSessionRegistry {
  private deletedSessions = new Set<string>()

  constructor(private redis: Redis) {}

  /** Registers a session as deleted, returning whether the registration was successful. */
  register(sessionKey: string): boolean {
    if (!this.deletedSessions.has(sessionKey)) {
      this.deletedSessions.add(sessionKey)
      setTimeout(() => {
        // Re-delete the key later just in case things interleaved such that it got refreshed
        this.redis.del(sessionKey).catch(swallowNonBuiltins)
        this.deletedSessions.delete(sessionKey)
      }, 60 * 1000)

      return true
    }

    return false
  }
}
