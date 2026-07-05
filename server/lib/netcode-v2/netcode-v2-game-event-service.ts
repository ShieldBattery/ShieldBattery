import got from 'got'
import { verify as verifyEd25519 } from 'node:crypto'
import {
  NetcodeV2DepartureNotification,
  NetcodeV2DesyncNotification,
} from '../../../common/games/netcode-v2'
import { makeSbUserId, SbUserId } from '../../../common/users/sb-user-id'
import log from '../logging/logger'
import { recordDesyncEvent } from '../models/game-desync-events'
import { recordUserDeparture } from '../models/games-users'
import { loadConfigFromEnv } from './netcode-v2-service'
import { TenantPubkeyCache } from './tenant-pubkey-cache'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** HTTP status an unauthenticated/disabled-feature game-events webhook call should get. */
export type GameEventWebhookAuthStatus = 401 | 404

/** How the `x-rp2-timestamp` + request body are combined into the bytes the signature covers. */
const SIGNATURE_MESSAGE_PREFIX = 'rp2-webhook-v1:'

/** How far a webhook's `x-rp2-timestamp` may drift from now before it's rejected as stale/replayed. */
const REPLAY_WINDOW_MS = 5 * 60 * 1000

interface TenantPubkeyResponse {
  kid: string
  publicKey: string
}

/** Fetches the rp2 tenant's current webhook-signing public key (hex) from the coordinator. */
async function fetchTenantPubkeyHex(): Promise<string> {
  const config = loadConfigFromEnv()
  if (!config) {
    throw new Error('netcode v2 is not configured')
  }

  const response = await got
    .get(`${config.coordinatorUrl}/tenant/${encodeURIComponent(config.tenant)}/pubkey`, {
      timeout: { request: 10000 },
    })
    .json<TenantPubkeyResponse>()

  return response.publicKey
}

const tenantPubkeyCache = new TenantPubkeyCache(fetchTenantPubkeyHex)

/**
 * Gates a game-events webhook call before anything else runs (including body validation): returns
 * the HTTP status to respond with if the call should be rejected, or `null` if it's authorized to
 * proceed.
 *
 * Auth is an Ed25519 signature over the request rather than a shared secret — the coordinator
 * signs each delivery attempt with its per-tenant signing key (the same one it uses for player
 * session tokens), so the app server verifies with the public half and holds no secret of its own.
 * That public key isn't local config — it's fetched from the coordinator
 * (`GET /tenant/:tenant/pubkey`) on first use and cached, with a rate-limited re-fetch on a
 * verification failure to pick up rotation (see `tenant-pubkey-cache.ts`). The signed message is
 * `"rp2-webhook-v1:" + <x-rp2-timestamp> + ":" + <raw request body bytes>`; the timestamp also
 * bounds how old a captured request can be before it's rejected as a replay.
 *
 * Netcode v2 not being configured (`SB_RP2_COORDINATOR_URL`/`SB_RP2_TENANT`) means the feature is
 * off and this always returns 404 — which also means this must run, and be respected, before any
 * body validation that could otherwise leak the endpoint's existence (or its expected shape) to an
 * unauthenticated caller. A key-fetch failure (coordinator down/timeout) is treated the same as an
 * unverifiable signature (401), not a crash — the next call retries.
 *
 * `pubkeyCache` defaults to the module's shared cache; tests inject their own to avoid network
 * calls and exercise rotation/rate-limit behavior directly.
 */
export async function checkGameEventWebhookAuth(
  timestampHeader: string,
  signatureHeader: string,
  rawBody: Buffer,
  pubkeyCache: TenantPubkeyCache = tenantPubkeyCache,
): Promise<GameEventWebhookAuthStatus | null> {
  if (!loadConfigFromEnv()) {
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

  const key = await pubkeyCache.getKey()
  if (!key) {
    return 401
  }
  if (verifyEd25519(null, message, key, signature)) {
    return null
  }

  // The cached key didn't verify — could be legitimate coordinator-side rotation. Re-fetch once
  // (rate-limited) and retry before giving up.
  const refreshedKey = await pubkeyCache.refetchAfterVerificationFailure()
  if (refreshedKey && verifyEd25519(null, message, refreshedKey, signature)) {
    return null
  }

  return 401
}

/**
 * Parses a webhook's `externalId` back into the app server's `gameId`, or returns `undefined` (and
 * logs) if it's missing or not a valid game id. Shared by both departure and desync ingest — the
 * coordinator's correlation id is the same `gameId` string in both cases.
 */
function parseGameId(externalId: string | undefined, eventKind: string): string | undefined {
  if (!externalId || !UUID_PATTERN.test(externalId)) {
    log.warn(
      { externalId },
      `netcode v2 ${eventKind} notification missing/invalid externalId, ignoring`,
    )
    return undefined
  }
  return externalId
}

/**
 * Parses a webhook's `externalRef` (the app server's stringified `SbUserId`) back into an
 * `SbUserId`, or returns `undefined` (and logs) if it's missing or not a positive integer. Shared
 * by both departure and desync ingest.
 */
function parseUserId(
  externalRef: string | undefined,
  context: Record<string, unknown>,
): SbUserId | undefined {
  const parsed = externalRef !== undefined ? Number(externalRef) : NaN
  if (!externalRef || !Number.isInteger(parsed) || parsed <= 0) {
    log.warn(
      { ...context, externalRef },
      'netcode v2 notification entry missing/invalid externalRef, skipping',
    )
    return undefined
  }
  return makeSbUserId(parsed)
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
  const gameId = parseGameId(notification.externalId, 'departure')
  if (!gameId) {
    return
  }

  const userId = parseUserId(notification.externalRef, { gameId })
  if (!userId) {
    return
  }

  const { kind } = notification
  const recorded = await recordUserDeparture({ userId, gameId, kind, time: new Date() })

  if (recorded) {
    log.info({ gameId, userId, kind }, 'departure recorded')
  } else {
    log.info({ gameId, userId, kind }, 'duplicate departure ignored')
  }
}

/**
 * Classifies and records a desync notification from an already-authenticated caller. Same
 * forgiving posture as departures: an unresolvable `externalId` (unknown/malformed) is logged and
 * dropped, always responding 204 to the coordinator. A diverged entry whose `externalRef` is
 * missing or unparseable is itself skipped (logged) while the rest of the event is still recorded
 * — a partially-unparseable event is still evidence worth keeping.
 */
export async function recordDesyncNotification(
  notification: NetcodeV2DesyncNotification,
): Promise<void> {
  const gameId = parseGameId(notification.externalId, 'desync')
  if (!gameId) {
    return
  }

  const { syncOrdinal, gameFrame, detectedAtMs, noMajority, diverged } = notification

  const divergedUserIds: SbUserId[] = []
  for (const entry of diverged) {
    const userId = parseUserId(entry.externalRef, { gameId, syncOrdinal, slot: entry.slot })
    if (userId !== undefined) {
      divergedUserIds.push(userId)
    }
  }

  const recorded = await recordDesyncEvent({
    gameId,
    syncOrdinal,
    detectedAt: new Date(detectedAtMs),
    gameFrame,
    noMajority,
    divergedUserIds,
  })

  if (recorded) {
    log.info({ gameId, syncOrdinal, noMajority, divergedUserIds }, 'desync event recorded')
  } else {
    log.info({ gameId, syncOrdinal }, 'duplicate desync event ignored')
  }
}
