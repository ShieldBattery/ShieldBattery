import got, { HTTPError } from 'got'
import { MatchmakingType } from '../../../common/matchmaking'
import { urlPath } from '../../../common/urls'
import { SbUserId } from '../../../common/users/sb-user-id'
import { serverRsUrl } from '../network/server-rs-requests'

/** Sent to Rust when adding a player to the queue. */
export interface RsQueueRequest {
  id: SbUserId
  rating: number
  /** Glicko-2 σ (uncertainty). null treated as 0 (fully certain). */
  uncertainty: number | null
  modes: MatchmakingType[]
  latencyBucket: number | null
}

/** Error response body returned by the Rust API on 4xx responses. */
export interface RsApiError {
  code: string
  message: string
}

/** Possible error codes the Rust API returns. */
export const RS_ERROR_CODES = {
  alreadyInQueue: 'alreadyInQueue',
  noModesSelected: 'noModesSelected',
  notFound: 'notFound',
  invalidTicket: 'invalidTicket',
  staleTicket: 'staleTicket',
} as const
export type RsErrorCode = (typeof RS_ERROR_CODES)[keyof typeof RS_ERROR_CODES]

export class RsMatchmakerError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'RsMatchmakerError'
  }

  get isStaleTicket() {
    return this.code === RS_ERROR_CODES.staleTicket
  }

  get isNotFound() {
    return this.code === RS_ERROR_CODES.notFound
  }
}

async function rsRequest(method: 'POST' | 'DELETE', path: string, body?: unknown): Promise<void> {
  try {
    await got(serverRsUrl(path), {
      method,
      json: body,
      throwHttpErrors: true,
    })
  } catch (err) {
    if (err instanceof HTTPError) {
      let errorBody: RsApiError | undefined
      try {
        errorBody = JSON.parse(err.response.body as string) as RsApiError
      } catch {
        // Rust returned a non-JSON error body (shouldn't happen in normal operation)
      }
      throw new RsMatchmakerError(
        err.response.statusCode,
        errorBody?.code ?? 'unknown',
        errorBody?.message ?? `Rust matchmaker returned ${err.response.statusCode}`,
      )
    }
    throw err
  }
}

/** Adds a player to the Rust matchmaker queue. */
export async function rsQueuePlayer(request: RsQueueRequest): Promise<void> {
  await rsRequest('POST', '/matchmaker', request)
}

/**
 * Removes a player from the Rust matchmaker queue (cancel or disconnect).
 * Silently succeeds if the player is not in the queue (404 is treated as success).
 */
export async function rsCancelPlayer(id: SbUserId): Promise<void> {
  try {
    await rsRequest('DELETE', urlPath`/matchmaker/${id}`)
  } catch (err) {
    if (err instanceof RsMatchmakerError && err.isNotFound) {
      return // Already removed — treat as success
    }
    throw err
  }
}

/**
 * Re-queues a player using a ticket from a previously-formed (but failed) match.
 * Throws `RsMatchmakerError` with `isStaleTicket === true` if the Rust service has restarted.
 */
export async function rsRequeuPlayer(ticket: string): Promise<void> {
  await rsRequest('POST', '/matchmaker/requeue', { ticket })
}
