import { KeyObject, createPublicKey, verify as verifyEd25519 } from 'node:crypto'
import { NetcodeV2DepartureNotification } from '../../../common/games/netcode-v2'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import log from '../logging/logger'
import { recordUserDeparture } from '../models/games-users'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** HTTP status an unauthenticated/disabled-feature departures webhook call should get. */
export type DepartureWebhookAuthStatus = 401 | 404

/** How the `x-rp2-timestamp` + request body are combined into the bytes the signature covers. */
const SIGNATURE_MESSAGE_PREFIX = 'rp2-webhook-v1:'

/** How far a webhook's `x-rp2-timestamp` may drift from now before it's rejected as stale/replayed. */
const REPLAY_WINDOW_MS = 5 * 60 * 1000

const HEX_PUBKEY_PATTERN = /^[0-9a-f]{64}$/i

/**
 * Parses the rp2 tenant's Ed25519 public key out of its `SB_RP2_TENANT_PUBKEY` hex form (64 hex
 * chars, the same format the rp2 dev coordinator prints for relays) into a `KeyObject`. Node's
 * `crypto` has no direct "raw Ed25519 public key" import, so this goes through a JWK
 * (`OKP`/`Ed25519`) construction, which only needs the raw key re-encoded as base64url.
 */
export function parseTenantPublicKeyHex(hex: string | undefined): KeyObject | undefined {
  if (!hex) {
    return undefined
  }
  if (!HEX_PUBKEY_PATTERN.test(hex)) {
    log.error(
      'SB_RP2_TENANT_PUBKEY is set but is not 64 hex characters; departures webhook is disabled',
    )
    return undefined
  }

  const rawKey = Buffer.from(hex, 'hex')
  return createPublicKey({
    key: { kty: 'OKP', crv: 'Ed25519', x: rawKey.toString('base64url') },
    format: 'jwk',
  })
}

const TENANT_PUBLIC_KEY = parseTenantPublicKeyHex(process.env.SB_RP2_TENANT_PUBKEY)

/**
 * Gates a departures webhook call before anything else runs (including body validation): returns
 * the HTTP status to respond with if the call should be rejected, or `null` if it's authorized to
 * proceed.
 *
 * Auth is an Ed25519 signature over the request rather than a shared secret — the coordinator
 * signs each delivery attempt with its per-tenant signing key (the same one it uses for player
 * session tokens), so the app server verifies with the public half and holds no secret at all. The
 * signed message is `"rp2-webhook-v1:" + <x-rp2-timestamp> + ":" + <raw request body bytes>`; the
 * timestamp also bounds how old a captured request can be before it's rejected as a replay.
 *
 * `SB_RP2_TENANT_PUBKEY` unset (or malformed) means the feature is off and this always returns 404
 * — which also means this must run, and be respected, before any body validation that could
 * otherwise leak the endpoint's existence (or its expected shape) to an unauthenticated caller.
 */
export function checkDepartureWebhookAuth(
  timestampHeader: string,
  signatureHeader: string,
  rawBody: Buffer,
): DepartureWebhookAuthStatus | null {
  if (!TENANT_PUBLIC_KEY) {
    return 404
  }

  if (!/^\d+$/.test(timestampHeader)) {
    return 401
  }
  const timestamp = Number(timestampHeader)
  if (!Number.isSafeInteger(timestamp) || Math.abs(Date.now() - timestamp) > REPLAY_WINDOW_MS) {
    return 401
  }

  if (!signatureHeader) {
    return 401
  }
  const signature = Buffer.from(signatureHeader, 'base64')
  if (signature.length !== 64) {
    return 401
  }

  const message = Buffer.concat([
    Buffer.from(`${SIGNATURE_MESSAGE_PREFIX}${timestampHeader}:`, 'utf8'),
    rawBody,
  ])

  if (!verifyEd25519(null, message, TENANT_PUBLIC_KEY, signature)) {
    return 401
  }

  return null
}

/**
 * Classifies and records a departure notification from an already-authenticated caller. Always
 * completes successfully from the caller's perspective (the caller responds 204 either way) — an
 * unparseable notification (missing/malformed correlation ids) is logged and dropped rather than
 * erroring back to the coordinator, and a notification that resolves to a real game+user is
 * recorded unconditionally, even if that game already has results — see `recordUserDeparture`'s
 * doc comment for why.
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
    log.info({ gameId, userId, kind }, 'departure recorded')
  } else {
    log.info({ gameId, userId, kind }, 'duplicate departure ignored')
  }
}
