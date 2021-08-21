import cuid from 'cuid'
import logger from '../logging/logger'
import { ClientSocketsGroup } from '../websockets/socket-groups'

enum AcceptStatus {
  Unaccepted,
  Accepted,
  Disconnected,
}

interface Match<MatchInfoType> {
  id: string
  info: MatchInfoType
  clients: Map<ClientSocketsGroup, AcceptStatus>
  timer?: ReturnType<typeof setTimeout>
}

export interface MatchAcceptorCallbacks<MatchInfoType> {
  /**
   * Callback for a new player accepting a match.
   *
   * @param matchInfo Information about the match this event is for
   * @param total The total number of players in the match
   * @param accepted The number of players who have accepted so far
   */
  onAcceptProgress: (
    matchInfo: Readonly<MatchInfoType>,
    total: number,
    accepted: number,
  ) => void | Promise<void>

  /**
   * Callback for when all clients for a match have accepted it.
   *
   * @param matchInfo Information about the match this event is for
   * @param clients The clients that this match is for
   */
  onAccepted: (
    matchInfo: Readonly<MatchInfoType>,
    clients: ReadonlyArray<ClientSocketsGroup>,
  ) => void | Promise<void>

  /**
   * Callback for when a match has been declined (either due to timeout, or a client leaving the
   * queue before the match was fully accepted).
   *
   * @param matchInfo Information about the match this event is for
   * @param requeueClients an iterable of clients who should be requeued
   * @param kickClients an iterable of clients who should be removed from the queue
   */
  onDeclined: (
    matchInfo: Readonly<MatchInfoType>,
    requeueClients: ReadonlyArray<ClientSocketsGroup>,
    kickClients: ReadonlyArray<ClientSocketsGroup>,
  ) => void | Promise<void>

  /**
   * Callback for when an error occurs (namely while calling other callbacks in this object).
   *
   * @param err The error that occurred
   * @param clients Clients that the error is relevant to
   */
  onError: (err: Error, clients: ReadonlyArray<ClientSocketsGroup>) => void
}

/**
 * A service for allowing clients to register acceptance of a matchmaking match, confirming that
 * they are active and ready to play. Each client can have at most one active match at any given
 * time.
 */
export default class MatchAcceptor<MatchInfoType> {
  private matches = new Map<string, Match<MatchInfoType>>()
  private clientToMatchId = new Map<ClientSocketsGroup, string>()

  /**
   * Constructs a new MatchAcceptor service.
   * @param acceptTimeMs the max time (in milliseconds) that clients will be given to accept. If a
   *     match is not accepted in this time period, it will be declined
   * @param callbacks functions that will be called when various events occur
   */
  constructor(
    private acceptTimeMs: number,
    private callbacks: MatchAcceptorCallbacks<MatchInfoType>,
  ) {}

  /**
   * Adds a match for potential acceptance.
   *
   * @param matchInfo Information about the match (will be sent to any callbacks about this match)
   * @param clients A list of clients the match is for, used for matching future accepts,
   *     disconnects, and timeouts.
   */
  addMatch(matchInfo: MatchInfoType, clients: ReadonlyArray<ClientSocketsGroup>) {
    const id = cuid()
    const match: Match<MatchInfoType> = {
      id,
      info: matchInfo,
      clients: new Map(clients.map(c => [c, AcceptStatus.Unaccepted])),
      timer: setTimeout(this.onMatchTimeout.bind(this, id), this.acceptTimeMs),
    }
    this.matches.set(id, match)
    for (const c of clients) {
      this.clientToMatchId.set(c, id)
    }
  }

  /**
   * Registers that a client has disconnected (and will not be accepting their match, if any).
   *
   * @returns `true` if there was a match, `false` otherwise
   */
  registerDisconnect(client: ClientSocketsGroup) {
    if (!this.clientToMatchId.has(client)) {
      return false
    }

    const id = this.clientToMatchId.get(client)!
    const match = this.matches.get(id)!
    match.clients.set(client, AcceptStatus.Disconnected)

    this.cleanupMatch(match)

    // Split clients between those who disconnected and those who haven't. Those who haven't
    // disconnected will be requeued, those who have disconnected will be kicked.
    const toRequeue: ClientSocketsGroup[] = []
    const toKick: ClientSocketsGroup[] = []
    for (const [c, status] of match.clients.entries()) {
      if (status !== AcceptStatus.Disconnected) {
        toRequeue.push(c)
      } else {
        toKick.push(c)
      }
    }

    this.declineMatch(match, toRequeue, toKick)

    return true
  }

  /**
   * Registers that a client has accepted their match (if any).
   *
   * @returns `true` if there was a match, `false` otherwise.
   */
  registerAccept(client: ClientSocketsGroup): boolean {
    if (!this.clientToMatchId.has(client)) {
      return false
    }

    const id = this.clientToMatchId.get(client)!
    const match = this.matches.get(id)!
    const oldValue = match.clients.get(client)
    if (oldValue === AcceptStatus.Accepted) {
      // This client had already accepted before, so this is a no-op update
      return true
    }

    match.clients.set(client, AcceptStatus.Accepted)

    const numAccepted = Array.from(match.clients.values()).filter(s => s === AcceptStatus.Accepted)
    if (numAccepted.length !== match.clients.size) {
      // Still waiting on at least one player
      Promise.resolve()
        .then(() =>
          this.callbacks.onAcceptProgress(match.info, match.clients.size, numAccepted.length),
        )
        .catch(err => this.callbacks.onError(err, Array.from(match.clients.keys())))
    } else {
      // All players have accepted
      this.cleanupMatch(match)
      Promise.resolve()
        .then(() => this.callbacks.onAccepted(match.info, Array.from(match.clients.keys())))
        .catch(err => this.callbacks.onError(err, Array.from(match.clients.keys())))
    }

    return true
  }

  private onMatchTimeout(id: string) {
    const match = this.matches.get(id)
    if (!match) {
      return
    }

    this.cleanupMatch(match)

    // Split clients between those who have accepted and those who haven't. Those who have accepted
    // will be requeued, everyone else will be kicked.
    const toRequeue: ClientSocketsGroup[] = []
    const toKick: ClientSocketsGroup[] = []
    for (const [c, status] of match.clients.entries()) {
      if (status === AcceptStatus.Accepted) {
        toRequeue.push(c)
      } else {
        toKick.push(c)
      }
    }
    this.declineMatch(match, toRequeue, toKick)
  }

  private cleanupMatch(match: Match<MatchInfoType>) {
    this.matches.delete(match.id)

    for (const c of match.clients.keys()) {
      const id = this.clientToMatchId.get(c)
      if (id && id !== match.id) {
        logger.error(
          { err: new Error('registered id for client does not match the one being cleaned up') },
          'error while cleaning up match',
        )
      }
      this.clientToMatchId.delete(c)
    }

    if (match.timer) {
      clearTimeout(match.timer)
    }
  }

  private declineMatch(
    match: Match<MatchInfoType>,
    toRequeue: ReadonlyArray<ClientSocketsGroup>,
    toKick: ReadonlyArray<ClientSocketsGroup>,
  ) {
    Promise.resolve()
      .then(() => this.callbacks.onDeclined(match.info, toRequeue, toKick))
      .catch(err => this.callbacks.onError(err, Array.from(match.clients.keys())))
  }
}
