import cuid from 'cuid'
import { Collection, List, Map, Record, Seq } from 'immutable'
import { ClientSocketsGroup } from '../websockets/socket-groups'

enum AcceptStatus {
  Unaccepted,
  Accepted,
  Disconnected,
}

const createMatch = Record({
  id: null as string | null,
  info: null as any,
  clients: Map<ClientSocketsGroup, AcceptStatus>(), // client -> status
  timer: null as ReturnType<typeof setTimeout> | null,
})

type Match = ReturnType<typeof createMatch>

export interface MatchAcceptorCallbacks<MatchInfoType> {
  /**
   * Callback for a new player accepting a match.
   *
   * @param matchInfo Information about the match this event is for
   * @param total The total number of players in the match
   * @param accepted The number of players who have accepted so far
   */
  onAcceptProgress: (
    matchInfo: MatchInfoType,
    total: number,
    accepted: number,
  ) => void | Promise<void>

  /**
   * Callback for when all clients for a match have accepted it.
   *
   * @param matchInfo Information about the match this event is for
   * @param clients The clients that this match is for
   */
  onAccepted: (matchInfo: MatchInfoType, clients: List<ClientSocketsGroup>) => void | Promise<void>

  /**
   * Callback for when a match has been declined (either due to timeout, or a client leaving the
   * queue before the match was fully accepted).
   *
   * @param matchInfo Information about the match this event is for
   * @param requeueClients an iterable of clients who should be requeued
   * @param kickClients an iterable of clients who should be removed from the queue
   */
  onDeclined: (
    matchInfo: MatchInfoType,
    requeueClients: List<ClientSocketsGroup>,
    kickClients: List<ClientSocketsGroup>,
  ) => void | Promise<void>

  /**
   * Callback for when an error occurs (namely while calling other callbacks in this object).
   *
   * @param err The error that occurred
   * @param clients Clients that the error is relevant to
   */
  onError: (err: Error, clients: List<ClientSocketsGroup>) => void
}

/**
 * A service for allowing clients to register acceptance of a matchmaking match, confirming that
 * they are active and ready to play. Each client can have at most one active match at any given
 * time.
 */
export default class MatchAcceptor<MatchInfoType> {
  private matches = Map<string, Match>()
  private clientToMatchId = Map<ClientSocketsGroup, string>()

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
  addMatch(matchInfo: MatchInfoType, clients: ClientSocketsGroup[]) {
    const id = cuid()
    const match = createMatch({
      id,
      info: matchInfo,
      clients: Map(clients.map(c => [c, AcceptStatus.Unaccepted])),
      timer: setTimeout(this.onMatchTimeout.bind(this, id), this.acceptTimeMs),
    })
    this.matches = this.matches.set(id, match)
    this.clientToMatchId = this.clientToMatchId.merge(Map(clients.map(c => [c, id])))
  }

  // Registers that a client has disconnected (and will not be accepting their match, if any).
  // Returns true if there was a match, false otherwise.
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
    // No need to update this.matches since this will be removed right after anyway
    const match = this.matches.get(id)!.setIn(['clients', client], AcceptStatus.Disconnected)

    this.cleanupMatch(match)

    // Split clients between those who disconnected and those who haven't. Those who haven't
    // disconnected will be requeued, those who have disconnected will be kicked.
    const split = match.clients.groupBy(status => status !== AcceptStatus.Disconnected)
    this.declineMatch(match, split)

    return true
  }

  /**
   * Registers that a client has accepted their match (if any).
   *
   * @returns `true` if there was a match, `false` otherwise.
   */
  registerAccept(client: ClientSocketsGroup) {
    if (!this.clientToMatchId.has(client)) {
      return false
    }

    const id = this.clientToMatchId.get(client)!
    const oldMatch = this.matches.get(id)!
    const match = oldMatch.setIn(['clients', client], AcceptStatus.Accepted)

    if (!match.clients.every(status => status === AcceptStatus.Accepted)) {
      // Still waiting on at least one player
      if (oldMatch !== match) {
        this.matches = this.matches.set(id, match)
        Promise.resolve(
          this.callbacks.onAcceptProgress(
            match.info,
            match.clients.size,
            match.clients.count(status => status === AcceptStatus.Accepted),
          ),
        ).catch(err => this.callbacks.onError(err, List(match.clients.keys())))
      }
    } else {
      // All players have accepted
      this.cleanupMatch(match)
      Promise.resolve(this.callbacks.onAccepted(match.info, List(match.clients.keys()))).catch(
        err => this.callbacks.onError(err, List(match.clients.keys())),
      )
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
    const split = match.clients.groupBy(status => status === AcceptStatus.Accepted)
    this.declineMatch(match, split)
  }

  private cleanupMatch(match: Match) {
    this.matches = this.matches.delete(match.id!)
    this.clientToMatchId = this.clientToMatchId.withMutations(map => {
      for (const c of match.clients.keys()) {
        map.delete(c)
      }
    })
    if (match.timer !== null) {
      clearTimeout(match.timer)
    }
  }

  private declineMatch(
    match: Match,
    clients: Seq.Keyed<boolean, Collection<ClientSocketsGroup, AcceptStatus>>,
  ) {
    const requeueClients = clients.get(true)
    const kickClients = clients.get(false)
    Promise.resolve(
      this.callbacks.onDeclined(
        match.info,
        List(requeueClients ? requeueClients.keys() : []),
        List(kickClients ? kickClients.keys() : []),
      ),
    ).catch(err => this.callbacks.onError(err, List(match.clients.keys())))
  }
}
