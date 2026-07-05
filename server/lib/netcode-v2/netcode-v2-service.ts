import got from 'got'
import { createPrivateKey, KeyObject, sign, X509Certificate } from 'node:crypto'
import { isIP } from 'node:net'
import { singleton } from 'tsyringe'
import { raceAbort } from '../../../common/async/abort-signals'
import createDeferred, { Deferred } from '../../../common/async/deferred'
import { NetcodeV2RelayInfo, NetcodeV2ServerSetup } from '../../../common/games/netcode-v2'
import { SbUserId } from '../../../common/users/sb-user-id'
import { setNetcodeV2Session } from '../games/game-models'
import log from '../logging/logger'

/**
 * How many pubkeys we'll hold for a single loading game before ignoring further submissions. A
 * safety net on memory only — the API layer restricts submissions to game participants.
 */
const MAX_PUBKEYS_PER_GAME = 16

/**
 * How many session ids `checkSessionsAlive` will ask about in a single `POST /sessions/alive`
 * call. The sweep's probe candidate set is expected to be tiny in steady state, but this keeps a
 * single request bounded regardless.
 */
const SESSIONS_ALIVE_CHUNK_SIZE = 512

export class NetcodeV2ServiceError extends Error {}

/** A raw 32-byte Ed25519 seed as 64 hex characters — the `SB_RP2_CLIENT_KEY` format. */
const ED25519_SEED_HEX_PATTERN = /^[0-9a-f]{64}$/i

/** How the timestamp + method + path + body are combined into the bytes a request signature covers. */
const REQUEST_SIGNATURE_MESSAGE_PREFIX = 'rp2-request-v1:'

/**
 * The fixed 16-byte PKCS#8 v1 DER prefix for an Ed25519 private key; the raw 32-byte seed follows
 * it to form the 48-byte document Node's `createPrivateKey` accepts. We assemble it by hand because
 * the interchange format for the client key is the raw seed (hex) — ring (coordinator side) accepts
 * only PKCS#8 v2 and Node exports only v1, so neither side ships a PKCS#8 document; both derive a
 * keypair from the same raw seed instead. This mirrors `app/game/netcode-v2-keys.ts`, which
 * hand-assembles the v2 form for the game process. The RFC 8032 §7.1 test vector pins this layout
 * byte-for-byte (see the test), so drift breaks a test rather than silently producing a bad key.
 */
const PKCS8_V1_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex')

/**
 * Builds a Node Ed25519 signing `KeyObject` from a raw 32-byte seed given as hex, by wrapping it in
 * the fixed PKCS#8 v1 DER envelope. Exported for the cross-implementation test vector.
 */
export function clientSigningKeyFromSeedHex(seedHex: string): KeyObject {
  if (!ED25519_SEED_HEX_PATTERN.test(seedHex)) {
    throw new NetcodeV2ServiceError('SB_RP2_CLIENT_KEY must be 64 hex characters (a 32-byte seed)')
  }
  return createPrivateKey({
    key: Buffer.concat([PKCS8_V1_ED25519_PREFIX, Buffer.from(seedHex, 'hex')]),
    format: 'der',
    type: 'pkcs8',
  })
}

/**
 * The client signing key, built from `SB_RP2_CLIENT_KEY` and cached by its seed value. `loadConfig
 * FromEnv` already fails loudly at config time when the coordinator is configured without a valid
 * key, so this only builds the `KeyObject` — cached so it's assembled once (a new build only if the
 * env value changes, which in practice happens only across test cases that stub it). Reading the env
 * at call time (rather than a module-load constant) matches `loadConfigFromEnv`'s own pattern and
 * keeps the module testable with `vi.stubEnv`.
 */
let cachedClientSigningKey: { seedHex: string; key: KeyObject } | undefined

function getClientSigningKey(): KeyObject {
  const seedHex = process.env.SB_RP2_CLIENT_KEY
  if (!seedHex) {
    throw new NetcodeV2ServiceError('SB_RP2_CLIENT_KEY is not configured')
  }
  if (cachedClientSigningKey?.seedHex !== seedHex) {
    cachedClientSigningKey = { seedHex, key: clientSigningKeyFromSeedHex(seedHex) }
  }
  return cachedClientSigningKey.key
}

/**
 * The `x-rp2-timestamp` + `x-rp2-signature` header pair authenticating a coordinator-bound request.
 * Signs `rp2-request-v1:<unix seconds>:<METHOD uppercased>:<path>:<raw body>` with the client key —
 * the mirror image of the coordinator's webhook signature. Binding the method + path stops a signed
 * body being replayed against a different endpoint. There is deliberately no nonce: transport is
 * HTTPS in prod / loopback in dev, and a captured-in-window replay at worst mints a garbage session
 * that gets reaped.
 */
export function signCoordinatorRequest(
  method: string,
  path: string,
  body: string,
): { 'x-rp2-timestamp': string; 'x-rp2-signature': string } {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const message = Buffer.concat([
    Buffer.from(
      `${REQUEST_SIGNATURE_MESSAGE_PREFIX}${timestamp}:${method.toUpperCase()}:${path}:`,
      'utf8',
    ),
    Buffer.from(body, 'utf8'),
  ])
  return {
    'x-rp2-timestamp': timestamp,
    'x-rp2-signature': sign(null, message, getClientSigningKey()).toString('hex'),
  }
}

/**
 * The path a coordinator request signs into its signature: pathname plus any query string. The
 * coordinator verifies over `uri.path_and_query()`, so both sides must include the query — today's
 * endpoints carry none, but signing path-and-query keeps the two implementations from silently
 * diverging the day one does.
 */
function coordinatorRequestPath(url: string): string {
  const parsed = new URL(url)
  return parsed.pathname + parsed.search
}

/**
 * The wire shapes of the rally-point2 coordinator's `POST /session/create` API. These use the
 * coordinator's serde defaults: snake_case field names, and byte fields (pubkeys, tokens) encoded
 * as JSON arrays of numbers.
 */
interface CoordinatorSessionRequest {
  tenant: string
  /** The ShieldBattery `gameId`, echoed back on the coordinator's notification webhooks. */
  external_id: string
  players: Array<{
    slot: number
    client_pubkey: number[]
    external_ref: string
    /** Excludes this slot from the relay's desync sync-checksum comparator (serde-default false). */
    observer: boolean
  }>
  /**
   * Dev/testing only: slots that should home on a secondary relay instead of the session's primary
   * home, to force a genuine cross-relay (meshed) session. Omitted on a production request; the
   * coordinator ignores it unless a second relay is enrolled.
   */
  dev_relay_split?: number[]
}

interface CoordinatorRelayEndpoint {
  relay_id: number
  /** The relay's public address as `ip:port` (IPv6 addresses are bracketed). */
  relay_addr: string
  /** DER of the TLS leaf certificate the relay serves; clients pin exactly this cert. */
  cert_der: number[]
}

/** A per-slot home-relay override: a slot that homes on a relay other than `home_relay`. */
interface CoordinatorSlotHome {
  slot: number
  relay: CoordinatorRelayEndpoint
}

interface CoordinatorSessionResponse {
  session: number
  home_relay: CoordinatorRelayEndpoint
  /**
   * Per-slot home overrides. Empty on a production session (every slot homes on `home_relay`);
   * populated only for a dev-forced cross-relay split.
   */
  slot_homes?: CoordinatorSlotHome[]
  tokens: Array<{ slot: number; token: number[] }>
  /**
   * The tenant's configured turn-buffer range. The relay's own buffer law starts every session at
   * `min` and only sends a resize directive when its computed depth moves off that starting point,
   * so `min` is also the depth each client must seed its pipe at to agree with the relay from the
   * first turn.
   */
  bounds: { min: number; max: number }
}

export interface NetcodeV2Config {
  coordinatorUrl: string
  tenant: string
  /** TLS server name clients validate the relay certificate against. */
  relayServerName: string
  /**
   * Dev/testing knob: slot numbers that should home on a secondary relay instead of the session's
   * primary home relay, so cross-relay games can be exercised without a real network split between
   * players. Sent to the coordinator as the session-create request's `dev_relay_split` hint, which
   * homes those slots on a second relay; the coordinator ignores it when only one relay is enrolled.
   * Configured via SB_RP2_SPLIT_RELAYS (comma-separated slot numbers).
   */
  splitRelaySlots?: Set<number>
}

/**
 * Loads netcode v2's coordinator config from the environment. Exported so other modules that need
 * to talk to the same coordinator (e.g. the departures webhook's tenant pubkey fetch) share this
 * as their one source of truth for `coordinatorUrl`/`tenant`, rather than re-reading the env vars
 * themselves.
 */
export function loadConfigFromEnv(): NetcodeV2Config | undefined {
  const coordinatorUrl = process.env.SB_RP2_COORDINATOR_URL
  if (!coordinatorUrl) {
    return undefined
  }

  const tenant = process.env.SB_RP2_TENANT
  if (!tenant) {
    throw new Error('SB_RP2_COORDINATOR_URL is set but SB_RP2_TENANT is missing')
  }

  // The client key is required whenever the coordinator is configured: every
  // coordinator-bound request is signed with it, so a missing/malformed key
  // must fail loudly here (config time) rather than at the first request. This
  // validates presence + format; `getClientSigningKey` builds the actual
  // KeyObject from the same env var.
  const clientKeySeedHex = process.env.SB_RP2_CLIENT_KEY
  if (!clientKeySeedHex) {
    throw new Error('SB_RP2_COORDINATOR_URL is set but SB_RP2_CLIENT_KEY is missing')
  }
  if (!ED25519_SEED_HEX_PATTERN.test(clientKeySeedHex)) {
    throw new Error('SB_RP2_CLIENT_KEY must be 64 hex characters (a 32-byte Ed25519 seed)')
  }

  const splitRelaysRaw = process.env.SB_RP2_SPLIT_RELAYS
  const splitRelaySlots = splitRelaysRaw
    ? new Set(
        splitRelaysRaw
          .split(',')
          .map(s => Number(s.trim()))
          .filter(slot => Number.isInteger(slot)),
      )
    : undefined

  return {
    coordinatorUrl,
    tenant,
    relayServerName: process.env.SB_RP2_RELAY_SERVER_NAME ?? 'localhost',
    splitRelaySlots,
  }
}

/**
 * Converts a coordinator relay endpoint (a Rust `SocketAddr` display string — `ip:port`, with
 * IPv6 addresses bracketed — plus the relay's cert DER) into the relay endpoint shape clients
 * dial.
 */
function relayEndpointToInfo(
  peer: CoordinatorRelayEndpoint,
  config: NetcodeV2Config,
): NetcodeV2RelayInfo {
  const addr = peer.relay_addr
  let host: string
  let port: number
  if (addr.startsWith('[')) {
    const end = addr.indexOf(']')
    host = addr.slice(1, end)
    port = Number(addr.slice(end + 2))
  } else {
    const colon = addr.lastIndexOf(':')
    host = addr.slice(0, colon)
    port = Number(addr.slice(colon + 1))
  }
  const family = isIP(host)
  if (family === 0 || !Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new NetcodeV2ServiceError(`coordinator returned an unparseable relay address: ${addr}`)
  }

  // Parsing through X509Certificate validates the cert here, rather than letting a corrupt one
  // surface later as TLS pin failures inside every game client
  const certDer = Buffer.from(peer.cert_der)
  try {
    // eslint-disable-next-line no-new
    new X509Certificate(certDer)
  } catch (err) {
    throw new NetcodeV2ServiceError(
      `coordinator returned an unparseable cert for relay ${peer.relay_id}`,
      { cause: err },
    )
  }

  return {
    address4: family === 4 ? host : undefined,
    address6: family === 6 ? host : undefined,
    port,
    serverName: config.relayServerName,
    cert: certDer.toString('base64'),
  }
}

/**
 * Server-side control plane for netcode v2 (rally-point2): collects each player's per-session
 * public key during game loading, requests a session from the coordinator, and produces the
 * per-player handoff (token + relays + roster) the game loader publishes to clients.
 *
 * Enabled by setting `SB_RP2_COORDINATOR_URL` (plus `SB_RP2_TENANT`). The relay certificates
 * clients pin come from the coordinator's session response, per relay. When disabled, games load
 * exactly as before.
 */
@singleton()
export class NetcodeV2Service {
  private config = loadConfigFromEnv()
  /**
   * Per loading game, a deferred per user resolving to their submitted pubkey (base64). Created
   * lazily from whichever side arrives first (submission or session setup awaiting it); swept by
   * `discardGame` when the load ends.
   */
  private pendingGames = new Map<string, Map<SbUserId, Deferred<string>>>()

  isEnabled(): boolean {
    return !!this.config
  }

  /**
   * Records a player's per-session public key for a loading game. Returns false (without
   * recording) if the key is malformed. A repeated submission keeps the first key.
   */
  registerPubkey(gameId: string, userId: SbUserId, pubkey: string): boolean {
    // NOTE(netcode-v2): Buffer.from silently skips invalid base64 rather than throwing; the API
    // layer's Joi validation is the real format gate, this length check is the belt to it.
    if (Buffer.from(pubkey, 'base64').length !== 32) {
      return false
    }

    const pending = this.getOrCreatePending(gameId)
    if (pending.size >= MAX_PUBKEYS_PER_GAME && !pending.has(userId)) {
      return false
    }

    this.getOrCreateWaiter(pending, userId).resolve(pubkey)
    return true
  }

  /**
   * Requests a rally-point2 session for a loading game: waits until every listed player has
   * submitted their public key, then asks the coordinator to mint the session, and returns each
   * player's server-side handoff. Cleans up all pubkey state for the game regardless of outcome.
   *
   * @param slots the rally-point2 slot assignment for every participant, in slot order
   */
  async createSessionForGame({
    gameId,
    slots,
    signal,
  }: {
    gameId: string
    slots: Array<{ slot: number; userId: SbUserId; observer: boolean }>
    signal: AbortSignal
  }): Promise<Map<SbUserId, NetcodeV2ServerSetup>> {
    const config = this.config
    if (!config) {
      throw new NetcodeV2ServiceError('netcode v2 is not configured')
    }

    try {
      const pubkeys = await this.waitForPubkeys(
        gameId,
        slots.map(s => s.userId),
        signal,
      )

      // Dev cross-relay split: the slots (present in this game) the operator flagged to home on a
      // secondary relay, forwarded to the coordinator as its `dev_relay_split` hint.
      const splitSlots = config.splitRelaySlots
        ? slots.map(s => s.slot).filter(slot => config.splitRelaySlots!.has(slot))
        : []

      const request: CoordinatorSessionRequest = {
        tenant: config.tenant,
        // eslint-disable-next-line camelcase
        external_id: gameId,
        players: slots.map(({ slot, userId, observer }) => ({
          slot,
          // eslint-disable-next-line camelcase
          client_pubkey: Array.from(Buffer.from(pubkeys.get(userId)!, 'base64')),
          // eslint-disable-next-line camelcase
          external_ref: String(userId),
          observer,
        })),
        // eslint-disable-next-line camelcase
        ...(splitSlots.length > 0 ? { dev_relay_split: splitSlots } : {}),
      }

      let session: CoordinatorSessionResponse
      try {
        // Serialize the body ourselves and sign those exact bytes (rather than
        // handing `got` a `json:` object) so the signature covers precisely what
        // goes on the wire — the coordinator verifies over the raw body.
        const url = `${config.coordinatorUrl}/session/create`
        const bodyStr = JSON.stringify(request)
        session = await got
          .post(url, {
            body: bodyStr,
            headers: {
              'content-type': 'application/json',
              ...signCoordinatorRequest('POST', coordinatorRequestPath(url), bodyStr),
            },
            timeout: { request: 10000 },
            signal,
          })
          .json<CoordinatorSessionResponse>()
      } catch (err) {
        throw new NetcodeV2ServiceError('coordinator session create failed', { cause: err })
      }

      log.info(
        `netcode v2 session ${session.session} created for game ${gameId} ` +
          `(home relay ${session.home_relay.relay_id})`,
      )

      // Persisted so the reconciliation sweep can later ask the coordinator whether this session
      // is still alive instead of blind-forcing on a timeout. Non-fatal: a game whose session id
      // fails to persist just falls back to the legacy timeout-based sweep for its backstop.
      try {
        await setNetcodeV2Session(gameId, session.session)
      } catch (err) {
        log.warn({ err, gameId }, `failed to persist netcode v2 session id for game ${gameId}`)
      }

      const homeRelay = relayEndpointToInfo(session.home_relay, config)
      // Per-slot home overrides from the coordinator's dev cross-relay split: each listed slot
      // homes on its own relay instead of the session's primary home. Empty on a normal session.
      const slotHomeBySlot = new Map(
        (session.slot_homes ?? []).map(({ slot, relay }) => [
          slot,
          relayEndpointToInfo(relay, config),
        ]),
      )
      if (slotHomeBySlot.size > 0) {
        log.info(
          `netcode v2 dev split-relays active for game ${gameId}: slot(s) ` +
            `${[...slotHomeBySlot.keys()].join(', ')} homing on a secondary relay`,
        )
      }

      const userBySlot = new Map(slots.map(({ slot, userId }) => [slot, userId]))

      const result = new Map<SbUserId, NetcodeV2ServerSetup>()
      for (const { slot, token } of session.tokens) {
        const userId = userBySlot.get(slot)
        if (userId === undefined) {
          throw new NetcodeV2ServiceError(`coordinator returned a token for unknown slot ${slot}`)
        }

        result.set(userId, {
          token: Buffer.from(token).toString('base64'),
          homeRelay: slotHomeBySlot.get(slot) ?? homeRelay,
          roster: slots,
          // Floored defensively: a misconfigured or unexpected coordinator bound of 0 would leave
          // the pipe with no latency at all to absorb the network round-trip.
          initialBufferTurns: Math.max(1, session.bounds.min),
        })
      }
      if (result.size !== slots.length) {
        throw new NetcodeV2ServiceError('coordinator response was missing a token for a player')
      }

      return result
    } finally {
      this.discardGame(gameId)
    }
  }

  /** Drops all pubkey state for a game (canceled, finished, or session established). */
  discardGame(gameId: string) {
    const pending = this.pendingGames.get(gameId)
    if (pending) {
      this.pendingGames.delete(gameId)
      for (const waiter of pending.values()) {
        // No-op for waiters that already resolved with a pubkey
        waiter.reject(new NetcodeV2ServiceError('game load ended before session setup completed'))
      }
    }
  }

  private async waitForPubkeys(
    gameId: string,
    userIds: SbUserId[],
    signal: AbortSignal,
  ): Promise<Map<SbUserId, string>> {
    const pending = this.getOrCreatePending(gameId)
    const waits = userIds.map(userId =>
      this.getOrCreateWaiter(pending, userId).then(pubkey => [userId, pubkey] as const),
    )
    return new Map(await raceAbort(signal, Promise.all(waits)))
  }

  private getOrCreatePending(gameId: string): Map<SbUserId, Deferred<string>> {
    let pending = this.pendingGames.get(gameId)
    if (!pending) {
      pending = new Map()
      this.pendingGames.set(gameId, pending)
    }
    return pending
  }

  private getOrCreateWaiter(
    pending: Map<SbUserId, Deferred<string>>,
    userId: SbUserId,
  ): Deferred<string> {
    let waiter = pending.get(userId)
    if (!waiter) {
      waiter = createDeferred<string>()
      // Avoid unhandled rejection noise when a game is discarded with no one awaiting this user
      waiter.catch(() => {})
      pending.set(userId, waiter)
    }
    return waiter
  }
}

interface SessionsAliveResponse {
  alive: number[]
}

/**
 * Asks the rally-point2 coordinator which of the given session ids are still alive, in batches of
 * at most `SESSIONS_ALIVE_CHUNK_SIZE`. A session id the coordinator omits from its response is
 * gone or unknown to it — safe to treat as no longer live.
 *
 * Exported standalone (rather than a method on `NetcodeV2Service`) alongside `loadConfigFromEnv`,
 * for the same reason: the reconciliation sweep needs this without going through the game-loading
 * service's DI lifecycle.
 *
 * Throws if netcode v2 isn't configured or a batch request fails; callers decide how to handle
 * that themselves.
 */
export async function checkSessionsAlive(sessions: readonly number[]): Promise<Set<number>> {
  const config = loadConfigFromEnv()
  if (!config) {
    throw new NetcodeV2ServiceError('netcode v2 is not configured')
  }
  if (sessions.length === 0) {
    return new Set()
  }

  const alive = new Set<number>()
  for (let i = 0; i < sessions.length; i += SESSIONS_ALIVE_CHUNK_SIZE) {
    const chunk = sessions.slice(i, i + SESSIONS_ALIVE_CHUNK_SIZE)
    const url = `${config.coordinatorUrl}/sessions/alive`
    const bodyStr = JSON.stringify({ tenant: config.tenant, sessions: chunk })
    const response = await got
      .post(url, {
        body: bodyStr,
        headers: {
          'content-type': 'application/json',
          ...signCoordinatorRequest('POST', coordinatorRequestPath(url), bodyStr),
        },
        timeout: { request: 10000 },
      })
      .json<SessionsAliveResponse>()
    for (const session of response.alive) {
      alive.add(session)
    }
  }

  return alive
}
