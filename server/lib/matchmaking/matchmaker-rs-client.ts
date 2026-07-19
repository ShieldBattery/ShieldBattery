import got, { HTTPError } from 'got'
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
}

/** Sent to Rust when adding a player to the queue. */
export interface RsQueueRequest {
  id: SbUserId
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

async function rsRequest(
  method: 'POST' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<Result<void, RsMatchmakerError>> {
  try {
    await got(serverRsUrl(path), {
      method,
      json: body,
      throwHttpErrors: true,
    })
    return Result.ok()
  } catch (err) {
    return Result.error(toRsError(err))
  }
}

/** Fetches the current process token from the Rust matchmaker. */
export async function rsGetProcessToken(): Promise<Result<string, RsMatchmakerError>> {
  try {
    const response = await got(serverRsUrl('/matchmaker/token')).json<{ processToken: string }>()
    return Result.ok(response.processToken)
  } catch (err) {
    return Result.error(toRsError(err))
  }
}

/** Adds a player to the Rust matchmaker queue. */
export function rsQueuePlayer(request: RsQueueRequest): Promise<Result<void, RsMatchmakerError>> {
  return rsRequest('POST', '/matchmaker', request)
}

/**
 * Removes a player from the Rust matchmaker queue (cancel or disconnect). A `notFound` response is
 * treated as success, since it means the player is already out of the queue.
 */
export async function rsCancelPlayer(id: SbUserId): Promise<Result<void, RsMatchmakerError>> {
  const result = await rsRequest('DELETE', urlPath`/matchmaker/${id}`)
  return result.isError() && result.error.code === RsMatchmakerErrorCode.NotFound
    ? Result.ok()
    : result
}

/**
 * Re-queues a player using a ticket from a previously-formed (but failed) match. Fails with
 * `code === RsMatchmakerErrorCode.StaleTicket` if the Rust service has restarted since the ticket
 * was issued.
 */
export function rsRequeuePlayer(ticket: string): Promise<Result<void, RsMatchmakerError>> {
  return rsRequest('POST', '/matchmaker/requeue', { ticket })
}
