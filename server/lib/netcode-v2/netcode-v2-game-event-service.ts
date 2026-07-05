import got from 'got'
import { verify as verifyEd25519 } from 'node:crypto'
import { Logger } from 'pino'
import { container } from 'tsyringe'
import { GameRecord } from '../../../common/games/games'
import {
  NetcodeV2DepartureNotification,
  NetcodeV2DesyncNotification,
  NetcodeV2ResultNotification,
  NetcodeV2SessionClosedNotification,
} from '../../../common/games/netcode-v2'
import { GameClientPlayerResult, GameResultErrorCode } from '../../../common/games/results'
import { makeSbUserId, SbUserId } from '../../../common/users/sb-user-id'
import { getGameRecord } from '../games/game-models'
import GameResultService, {
  GameResultServiceError,
  isResultsExempt,
  SUBMIT_GAME_RESULTS_REQUEST_SCHEMA,
} from '../games/game-result-service'
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

/** The `maybeScheduleKnownCompleteReconcile` call the webhook ingest paths need, factored out for injection in tests. */
type ScheduleKnownCompleteReconcile = (gameId: string) => Promise<void>

/** Production `ScheduleKnownCompleteReconcile`: resolves the singleton service from the DI container. */
const defaultScheduleKnownCompleteReconcile: ScheduleKnownCompleteReconcile = gameId =>
  container.resolve(GameResultService).maybeScheduleKnownCompleteReconcile(gameId)

/** The `GameResultService.forceReconcileGame` call `recordSessionClosedNotification` needs, factored out for injection in tests. */
type ForceReconcile = (gameId: string) => Promise<void>

/** Production `ForceReconcile`: resolves the singleton service from the DI container. */
const defaultForceReconcile: ForceReconcile = gameId =>
  container.resolve(GameResultService).forceReconcileGame(gameId)

/** The `submitGameResults` call `submitRelayResult` needs, factored out for injection in tests. */
type SubmitGameResults = (args: {
  gameId: string
  userId: SbUserId
  resultCode: string
  time: number
  playerResults: ReadonlyArray<[playerId: SbUserId, result: GameClientPlayerResult]>
  relayReportTime: Date
  relayReportFrame: number | null
  logger: Logger
}) => Promise<void>

/** Production `SubmitGameResults`: resolves the singleton service from the DI container. */
const defaultSubmitGameResults: SubmitGameResults = args =>
  container.resolve(GameResultService).submitGameResults(args)

/** The `getGameRecord` lookup the exempt-game check needs, factored out for injection in tests. */
type GetGameRecord = (gameId: string) => Promise<GameRecord | undefined>

/** Production `GetGameRecord`: reads directly from the games model. */
const defaultGetGameRecord: GetGameRecord = gameId => getGameRecord(gameId)

/**
 * Whether a game is exempt from result tracking (contains a computer player — see
 * `isResultsExempt`), used to drop a relay-borne result before it ever reaches
 * `submitGameResults`. Treats a game that can't be found as not exempt, leaving that case for
 * `submitGameResults` itself to report as `NotFound`.
 */
async function isExemptResultGame(
  gameId: string,
  getGameRecordFn: GetGameRecord,
): Promise<boolean> {
  const gameRecord = await getGameRecordFn(gameId)
  return gameRecord ? isResultsExempt(gameRecord.config) : false
}

/**
 * Decodes, validates, and submits a relay-forwarded result report through
 * `GameResultService.submitGameResults` — the shared pipeline behind both the standalone `result`
 * webhook and a departure's embedded result, since both carry the exact same opaque payload shape.
 *
 * Same forgiving posture throughout: an undecodable/invalid payload, or a payload whose `userId`
 * doesn't match the already-resolved `userId` (a malicious or corrupt relay/coordinator), is logged
 * and dropped rather than erroring back to the coordinator. A duplicate delivery of an
 * already-submitted result is expected (the webhook is at-least-once, and a departure's embedded
 * result is itself redundant with an earlier standalone report) and is likewise silent. An
 * unexpected (non-domain) error from the submission service is rethrown.
 *
 * @returns whether a fresh report was actually submitted — `false` covers every dropped/duplicate
 *   path, so callers that gate other work on "did this webhook just close out a slot" can tell the
 *   difference.
 */
async function submitRelayResult(
  {
    gameId,
    userId,
    payload,
    arrivalMs,
    sessionFrame,
  }: {
    gameId: string
    userId: SbUserId
    payload: string
    arrivalMs: number
    sessionFrame?: number
  },
  submitGameResults: SubmitGameResults,
): Promise<boolean> {
  let parsedPayload: unknown
  try {
    parsedPayload = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'))
  } catch (err) {
    log.warn({ gameId, userId, err }, 'netcode v2 result payload could not be decoded, dropping')
    return false
  }

  const { error, value: body } = SUBMIT_GAME_RESULTS_REQUEST_SCHEMA.validate(parsedPayload)
  if (error) {
    log.warn(
      { gameId, userId, err: error },
      'netcode v2 result payload failed schema validation, dropping',
    )
    return false
  }

  if (body.userId !== userId) {
    log.warn(
      { gameId, userId, payloadUserId: body.userId },
      'netcode v2 result payload userId does not match externalRef, dropping',
    )
    return false
  }

  try {
    await submitGameResults({
      gameId,
      userId,
      resultCode: body.resultCode,
      time: body.time,
      playerResults: body.playerResults,
      relayReportTime: new Date(arrivalMs),
      relayReportFrame: sessionFrame ?? null,
      logger: log,
    })
    log.info({ gameId, userId }, 'result recorded via relay webhook')
    return true
  } catch (err) {
    if (err instanceof GameResultServiceError && err.code === GameResultErrorCode.AlreadyReported) {
      log.debug({ gameId, userId }, 'duplicate relay result ignored')
      return false
    }
    if (err instanceof GameResultServiceError) {
      log.warn({ gameId, userId, err }, 'relay result rejected by submission service, dropping')
      return false
    }
    throw err
  }
}

/**
 * Classifies and records a departure notification from an already-authenticated caller. Always
 * completes successfully from the caller's perspective (the caller responds 204 either way) — an
 * unparseable notification (missing/malformed correlation ids) is logged and dropped rather than
 * erroring back to the coordinator, and a notification that resolves to a real game+user is
 * recorded unconditionally, even if that game already has results — see `recordUserDeparture`'s
 * doc comment for why.
 *
 * A departure carrying an embedded `result` submits it through the same pipeline as the standalone
 * `result` webhook, before the departure itself is recorded — a departure is atomic terminal truth
 * for its slot, so its result (if any) lands first. This is expected to duplicate an earlier
 * standalone report for the same slot (the fast path at the victory dialog); `submitRelayResult`
 * silently no-ops on that overlap. An embedded result for a results-exempt game (contains computer
 * players) is dropped before it reaches `submitGameResults` — there was never anything to
 * reconcile for it — but the departure itself is still recorded below regardless, which is
 * harmless.
 *
 * @param submitGameResults injectable for testing; defaults to the real service.
 * @param scheduleKnownCompleteReconcile injectable for testing; defaults to the real service.
 * @param getGameRecordFn injectable for testing; defaults to the real games model.
 */
export async function recordDepartureNotification(
  notification: NetcodeV2DepartureNotification,
  submitGameResults: SubmitGameResults = defaultSubmitGameResults,
  scheduleKnownCompleteReconcile: ScheduleKnownCompleteReconcile = defaultScheduleKnownCompleteReconcile,
  getGameRecordFn: GetGameRecord = defaultGetGameRecord,
): Promise<void> {
  const gameId = parseGameId(notification.externalId, 'departure')
  if (!gameId) {
    return
  }

  const userId = parseUserId(notification.externalRef, { gameId })
  if (!userId) {
    return
  }

  if (notification.result) {
    if (await isExemptResultGame(gameId, getGameRecordFn)) {
      log.debug(
        { gameId, userId },
        'dropping departure-embedded result for a results-exempt (computer) game',
      )
    } else {
      await submitRelayResult(
        {
          gameId,
          userId,
          payload: notification.result.payload,
          arrivalMs: notification.result.arrivalMs,
          sessionFrame: notification.result.sessionFrame,
        },
        submitGameResults,
      )
    }
  }

  const { kind } = notification
  const recorded = await recordUserDeparture({ userId, gameId, kind, time: new Date() })

  if (recorded) {
    log.info({ gameId, userId, kind }, 'departure recorded')
  } else {
    log.info({ gameId, userId, kind }, 'duplicate departure ignored')
  }

  // A departure can be the notice that closes the last still-open human slot in a netcode-v2 game,
  // regardless of whether this particular delivery was a fresh record or a duplicate retry (another
  // slot could have closed in between), so this check runs unconditionally once we have a resolved
  // game+user.
  await scheduleKnownCompleteReconcile(gameId)
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

/**
 * Classifies and records a result notification from an already-authenticated caller: this is the
 * only way a netcode-v2 game's result reaches the server, so a notification that resolves to a
 * real game+user is submitted through the same service the direct `results2` endpoint uses.
 *
 * Same forgiving posture as departures/desync — an unresolvable `externalId`/`externalRef`, an
 * undecodable/invalid payload, or a payload whose `userId` doesn't match `externalRef` (a
 * malicious or corrupt relay/coordinator) is logged and dropped rather than erroring back to the
 * coordinator. A duplicate delivery of an already-submitted result is expected (the webhook is
 * at-least-once) and is likewise silent. A result for a results-exempt game (contains computer
 * players) is dropped the same way, before it reaches `submitGameResults` — there was never
 * anything to reconcile for it.
 *
 * @param submitGameResults injectable for testing; defaults to the real service.
 * @param scheduleKnownCompleteReconcile injectable for testing; defaults to the real service.
 * @param getGameRecordFn injectable for testing; defaults to the real games model.
 */
export async function recordResultNotification(
  notification: NetcodeV2ResultNotification,
  submitGameResults: SubmitGameResults = defaultSubmitGameResults,
  scheduleKnownCompleteReconcile: ScheduleKnownCompleteReconcile = defaultScheduleKnownCompleteReconcile,
  getGameRecordFn: GetGameRecord = defaultGetGameRecord,
): Promise<void> {
  const gameId = parseGameId(notification.externalId, 'result')
  if (!gameId) {
    return
  }

  const userId = parseUserId(notification.externalRef, { gameId })
  if (!userId) {
    return
  }

  if (await isExemptResultGame(gameId, getGameRecordFn)) {
    log.debug({ gameId, userId }, 'dropping result for a results-exempt (computer) game')
    return
  }

  const submitted = await submitRelayResult(
    {
      gameId,
      userId,
      payload: notification.payload,
      arrivalMs: notification.arrivalMs,
      sessionFrame: notification.sessionFrame,
    },
    submitGameResults,
  )
  if (!submitted) {
    return
  }

  // This result may have just closed the last still-open human slot in the game.
  await scheduleKnownCompleteReconcile(gameId)
}

/**
 * Classifies and records a `sessionClosed` notification from an already-authenticated caller.
 * The coordinator only sends this once every relay serving the session has torn down its state and
 * webhook dispatch for the session is serialized, so by the time this arrives every other notice
 * for the session was already delivered or permanently exhausted — nothing for it is still in
 * flight. There's nothing left to gate on, so this force-reconciles the game immediately with
 * whatever evidence has landed, covering a slot whose result and departure were both lost.
 *
 * Same forgiving posture as the other event kinds — an unresolvable `externalId` is logged and
 * dropped — and never throws, so a reconciliation failure doesn't turn an already-successful
 * webhook delivery into an error response.
 *
 * @param forceReconcile injectable for testing; defaults to the real service.
 */
export async function recordSessionClosedNotification(
  notification: NetcodeV2SessionClosedNotification,
  forceReconcile: ForceReconcile = defaultForceReconcile,
): Promise<void> {
  const gameId = parseGameId(notification.externalId, 'sessionClosed')
  if (!gameId) {
    return
  }

  await forceReconcile(gameId)
}
