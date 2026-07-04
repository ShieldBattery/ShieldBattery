import { timingSafeEqual } from 'node:crypto'
import { NetcodeV2DepartureNotification } from '../../../common/games/netcode-v2'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import log from '../logging/logger'
import { recordUserDeparture } from '../models/games-users'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** HTTP status an unauthenticated/disabled-feature departures webhook call should get. */
export type DepartureWebhookAuthStatus = 401 | 404

/**
 * Checks a bearer `Authorization` header against the configured notify secret in constant time,
 * so the comparison can't leak the secret's contents through response-timing differences.
 */
function isAuthorized(authorizationHeader: string | undefined, secret: string): boolean {
  if (!authorizationHeader?.startsWith('Bearer ')) {
    return false
  }

  const provided = Buffer.from(authorizationHeader.slice('Bearer '.length))
  const expected = Buffer.from(secret)
  if (provided.length !== expected.length) {
    return false
  }

  return timingSafeEqual(provided, expected)
}

/**
 * Gates a departures webhook call before anything else runs (including body validation): returns
 * the HTTP status to respond with if the call should be rejected, or `null` if it's authorized to
 * proceed.
 *
 * Auth is a bearer secret rather than a user session — the caller is the trusted coordinator, not
 * an end user. The secret is read from `SB_RP2_NOTIFY_SECRET` on every call (rather than cached),
 * so the feature can be toggled without a restart-sensitive load path: unset means the feature is
 * off and the endpoint always reports not-found, so its existence isn't revealed either — which
 * also means this must run, and be respected, before any body validation that could otherwise
 * leak the endpoint's existence (or its expected shape) to an unauthenticated caller.
 */
export function checkDepartureWebhookAuth(
  authorizationHeader: string | undefined,
): DepartureWebhookAuthStatus | null {
  const secret = process.env.SB_RP2_NOTIFY_SECRET
  if (!secret) {
    return 404
  }
  if (!isAuthorized(authorizationHeader, secret)) {
    return 401
  }

  return null
}

/**
 * Classifies and records a departure notification from an already-authenticated caller. Always
 * completes successfully from the caller's perspective (the caller responds 204 either way) — an
 * unrecordable/moot notification is a normal outcome, not an error, per the §19 classification
 * rule: a departure for a game+player that already holds a terminal result is discarded.
 */
export async function recordDepartureNotification(
  notification: NetcodeV2DepartureNotification,
): Promise<void> {
  const { externalId: gameId, externalRef, kind } = notification

  if (!gameId || !UUID_PATTERN.test(gameId)) {
    log.warn({ gameId }, 'netcode v2 departure notification missing/invalid externalId, ignoring')
    return
  }

  const parsedUserId = externalRef !== undefined ? Number(externalRef) : NaN
  if (!externalRef || !Number.isInteger(parsedUserId) || parsedUserId <= 0) {
    log.warn(
      { gameId, externalRef },
      'netcode v2 departure notification missing/invalid externalRef, ignoring',
    )
    return
  }

  const userId = makeSbUserId(parsedUserId)
  const recorded = await recordUserDeparture({ userId, gameId, kind, time: new Date() })

  if (recorded) {
    log.info({ gameId, userId, kind }, 'mid-game departure recorded')
  } else {
    log.info(
      { gameId, userId, kind },
      'departure ignored (terminal result already held or duplicate)',
    )
  }
}
