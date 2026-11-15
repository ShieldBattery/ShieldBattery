import { singleton } from 'tsyringe'
import { SbUserId } from '../../../common/users/sb-user-id'

function clientKey(userId: SbUserId, clientId: string) {
  return `${userId}|${clientId}`
}

/**
 * Tracks the machine support status reported by each client's open connections. A client is
 * supported unless one of its open connections reported otherwise.
 */
@singleton()
export class MachineSupportRegistry {
  /** IDs of the connections that reported an unsupported machine, keyed by client. */
  private unsupported = new Map<string, Set<string>>()

  /** Records the status a client reported over one of its connections. */
  record(userId: SbUserId, clientId: string, connectionId: string, supported: boolean) {
    if (supported) {
      this.forget(userId, clientId, connectionId)
      return
    }

    const key = clientKey(userId, clientId)
    const connections = this.unsupported.get(key)
    if (connections) {
      connections.add(connectionId)
    } else {
      this.unsupported.set(key, new Set([connectionId]))
    }
  }

  /** Forgets the status a client reported over a connection, once that connection closes. */
  forget(userId: SbUserId, clientId: string, connectionId: string) {
    const key = clientKey(userId, clientId)
    const connections = this.unsupported.get(key)
    if (!connections) return

    connections.delete(connectionId)
    if (!connections.size) {
      this.unsupported.delete(key)
    }
  }

  isSupported(userId: SbUserId, clientId: string): boolean {
    return !this.unsupported.has(clientKey(userId, clientId))
  }
}
