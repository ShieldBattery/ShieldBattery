import got, { HTTPError } from 'got'
import { singleton } from 'tsyringe'
import { Result } from 'typescript-result'
import { GameServerRegionId } from '../../../common/game-server-regions'
import { SbMapId } from '../../../common/maps'
import { MatchmakingType } from '../../../common/matchmaking'
import { RsMatchmakerErrorCode } from '../../../common/typeshare'
import { urlPath } from '../../../common/urls'
import { SbUserId } from '../../../common/users/sb-user-id'
import { serverRsUrl } from '../network/server-rs-requests'

export { RsMatchmakerErrorCode }

/** Per-mode rating sent to Rust when queuing for multiple matchmaking types. */
export interface RsModeRating {
  mode: MatchmakingType
  rating: number
  /** Glicko-2 σ (uncertainty). null treated as 0 (fully certain). */
  uncertainty: number | null
  /**
   * The player's positive map selections for this mode, for "pick" modes only. The matchmaker uses
   * these to avoid matching players who share no map (which would produce a match with no playable
   * map). `null` for veto/fixed modes, which don't constrain matching on maps.
   */
  mapSelections: SbMapId[] | null
  /**
   * Opponents from the player's recent games in this mode. The matchmaker uses these to discourage
   * pairing the same players again right away.
   */
  recentOpponents: RsRecentOpponent[]
}

/** An opponent from one of a player's recent games, as sent to Rust when queuing. */
export interface RsRecentOpponent {
  userId: SbUserId
  /** How many seconds before the player queued that game started. */
  secondsAgo: number
}

/** Sent to Rust when adding a player to the queue. */
export interface RsQueueRequest {
  id: SbUserId
  /**
   * Identifies the search being queued. The matchmaker echoes it with every match it forms from the
   * queue entry, including after a requeue, so a match can be traced to the search it came from.
   */
  searchId: string
  /**
   * Per-mode ratings. One entry per queued mode; Rust derives the set of queued modes from these
   * entries, so there must be exactly one per type the player is queuing for.
   */
  modeRatings: RsModeRating[]
  /**
   * The game server region the player wants to home in. Combined with `rttMs` and the matchmaker's
   * backbone RTT table to estimate a candidate match's latency (one-way estimate =
   * `rttMs/2 + backbone(regionA, regionB)/2 + otherRttMs/2`). Omitted when the client reported no
   * region (dev loopback / no coordinator-configured regions); such a player carries no latency
   * signal and pairs involving them are not penalized.
   */
  region?: GameServerRegionId
  /** The player's measured round-trip time (ms) to `region`. Present only alongside `region`. */
  rttMs?: number
}

/** Error response body returned by the Rust API on 4xx responses. */
interface RsApiError {
  code: string
  message: string
}

/**
 * Error codes that originate on this (Node) side of the bridge rather than in a Rust error
 * response: we couldn't reach server-rs at all, or it returned a code we don't recognize. Kept
 * separate from the typeshared `RsMatchmakerErrorCode` because Rust never sends these.
 */
export enum RsClientErrorCode {
  /** Couldn't reach the Rust matchmaker at all (connection refused, timeout, DNS failure, …). */
  ServiceUnavailable = 'serviceUnavailable',
  /** Rust returned an error response whose `code` we didn't recognize. */
  Unknown = 'unknown',
}

/** Every code an `RsMatchmakerError` can carry — one Rust returned, or a client-side one. */
export type RsErrorCode = RsMatchmakerErrorCode | RsClientErrorCode

const KNOWN_RUST_CODES: ReadonlySet<string> = new Set(Object.values(RsMatchmakerErrorCode))

/** Maps the raw `code` from a Rust error body to a known code, falling back to `Unknown`. */
function toRsErrorCode(code: string | undefined): RsErrorCode {
  return code !== undefined && KNOWN_RUST_CODES.has(code)
    ? (code as RsMatchmakerErrorCode)
    : RsClientErrorCode.Unknown
}

/**
 * A failure talking to the Rust matchmaker. `code` is either a code Rust returned
 * (`RsMatchmakerErrorCode`) or, when we couldn't reach it / couldn't understand the response, a
 * client-side `RsClientErrorCode`. Callers branch on `code` rather than `instanceof` checks.
 */
export class RsMatchmakerError extends Error {
  constructor(
    readonly code: RsErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options)
    this.name = 'RsMatchmakerError'
  }
}

/** Converts any error thrown by `got` into a typed `RsMatchmakerError`. */
function toRsError(err: unknown): RsMatchmakerError {
  if (err instanceof HTTPError) {
    let errorBody: RsApiError | undefined
    try {
      errorBody = JSON.parse(err.response.body as string) as RsApiError
    } catch {
      // Rust returned a non-JSON error body (shouldn't happen in normal operation)
    }
    return new RsMatchmakerError(
      toRsErrorCode(errorBody?.code),
      errorBody?.message ?? `Rust matchmaker returned ${err.response.statusCode}`,
      { cause: err },
    )
  }
  // Anything that isn't an HTTP error response means the request never completed — connection
  // refused, timeout, DNS failure, etc. Collapse them all into `serviceUnavailable` so callers
  // handle "Rust is unreachable" in exactly one place.
  return new RsMatchmakerError(
    RsClientErrorCode.ServiceUnavailable,
    `Couldn't reach the Rust matchmaker: ${String(err)}`,
    { cause: err },
  )
}

/**
 * How long a request to the Rust matchmaker gets before it fails as `serviceUnavailable`. The
 * matchmaker is on the local network and normally answers in milliseconds, so a request that takes
 * this long is hung. A player's requests are sent one at a time, so one hung request would otherwise
 * hold up all of that player's later ones. This is shorter than the restart watchdog's poll interval,
 * so the watchdog's polls never overlap.
 *
 * A request that times out may still reach the matchmaker and take effect afterwards. A queue or
 * requeue request that lands late is either refused, because the player's next search is already
 * queued, or adds an entry for a search that has ended: any match formed from it names that search
 * and is dropped, and the player's next queue request replaces it. A removal that lands late would
 * remove whatever entry the player has by then, so removals name the search they're for.
 */
export const RS_REQUEST_TIMEOUT_MS = 4000

const REQUEST_OPTIONS = {
  timeout: { request: RS_REQUEST_TIMEOUT_MS },
  // Retries would let one call outlast the timeout, and whether retrying is safe depends on the call
  retry: { limit: 0 },
} as const

async function rsRequest(
  method: 'POST' | 'DELETE',
  path: string,
  { body, searchParams }: { body?: unknown; searchParams?: Record<string, string> } = {},
): Promise<Result<void, RsMatchmakerError>> {
  try {
    await got(serverRsUrl(path), {
      ...REQUEST_OPTIONS,
      method,
      json: body,
      searchParams,
      throwHttpErrors: true,
    })
    return Result.ok()
  } catch (err) {
    return Result.error(toRsError(err))
  }
}

/** The HTTP API of the Rust matchmaker, which holds the queue and forms matches from it. */
@singleton()
export class MatchmakerClient {
  /** Fetches the current process token, which changes whenever the matchmaker restarts. */
  async getProcessToken(): Promise<Result<string, RsMatchmakerError>> {
    try {
      const response = await got(serverRsUrl('/matchmaker/token'), REQUEST_OPTIONS).json<{
        processToken: string
      }>()
      return Result.ok(response.processToken)
    } catch (err) {
      return Result.error(toRsError(err))
    }
  }

  /** Adds a player to the queue. */
  queue(request: RsQueueRequest): Promise<Result<void, RsMatchmakerError>> {
    return rsRequest('POST', '/matchmaker', { body: request })
  }

  /**
   * Removes a player from the queue (cancel or disconnect). A `notFound` response is treated as
   * success, since it means the player is already out of the queue.
   *
   * @param searchId The search to remove. The player's entry is only removed if it belongs to that
   *   search, so the removal can't take out a later search even if it lands after that search was
   *   queued. Omitted, whatever entry the player has is removed.
   */
  async cancel(id: SbUserId, searchId?: string): Promise<Result<void, RsMatchmakerError>> {
    const result = await rsRequest('DELETE', urlPath`/matchmaker/${id}`, {
      searchParams: searchId !== undefined ? { searchId } : undefined,
    })
    return result.isError() && result.error.code === RsMatchmakerErrorCode.NotFound
      ? Result.ok()
      : result
  }

  /**
   * Re-queues a player using a ticket from a previously-formed (but failed) match. Fails with
   * `code === RsMatchmakerErrorCode.StaleTicket` if the matchmaker has restarted since the ticket
   * was issued.
   */
  requeue(ticket: string): Promise<Result<void, RsMatchmakerError>> {
    return rsRequest('POST', '/matchmaker/requeue', { body: { ticket } })
  }
}
