import got from 'got'
import { createPrivateKey, KeyObject, sign, X509Certificate } from 'node:crypto'
import { isIP } from 'node:net'
import { singleton } from 'tsyringe'
import { raceAbort } from '../../../common/async/abort-signals'
import createDeferred, { Deferred } from '../../../common/async/deferred'
import { GameServerRegionId } from '../../../common/game-server-regions'
import {
  NetcodeV2RehomeResponse,
  NetcodeV2RelayEvent,
  NetcodeV2RelayInfo,
  NetcodeV2RosterEntry,
  NetcodeV2ServerSetup,
} from '../../../common/games/netcode-v2'
import { SbUserId } from '../../../common/users/sb-user-id'
import { addNetcodeV2RelayEvents, setNetcodeV2Session } from '../games/game-models'
import log from '../logging/logger'
import { worstPairwiseLatencyMs } from './latency-estimate'

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
    /**
     * The opaque id of the game-server region this slot asked to home in. Omitted when the player
     * reported none; the coordinator then places the slot region-blind (global lowest-id relay).
     * An unknown/unlit region also degrades to that fallback coordinator-side.
     */
    region?: string
  }>
  /**
   * The estimated worst pairwise one-way latency (ms) across the session's players, computed from
   * each slot's region + measured rtt. Omitted when no player pair carries enough signal to compute
   * it. The coordinator forwards this to relays as a fallback for the initial buffer depth, used
   * only until a relay's own pre-start observation of its home clients covers the whole session.
   */
  latency_estimate_ms?: number
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
   * Per-slot home overrides: slots homed on a relay other than `home_relay`. Empty when every slot
   * shares one relay; populated for a cross-region session (each slot homes in its requested
   * region, and the relays mesh).
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

/**
 * The wire shapes of the coordinator's `POST /session/rehome` API. Same serde conventions as
 * `/session/create` (snake_case, byte arrays as JSON number arrays). `dead_relay_id` is the relay
 * the client believes dead; the coordinator decides whether it's actually gone and, if so, moves
 * the whole group to a replacement.
 */
interface CoordinatorRehomeRequest {
  tenant: string
  session: number
  dead_relay_id: number
}

interface CoordinatorRehomeResponse {
  decision: 'stay' | 'unavailable' | 'newTarget'
  /** Present only for a `newTarget` decision: the replacement relay to dial. */
  relay?: CoordinatorRelayEndpoint
}

export interface NetcodeV2Config {
  coordinatorUrl: string
  tenant: string
  /** TLS server name clients validate the relay certificate against. */
  relayServerName: string
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

  return {
    coordinatorUrl,
    tenant,
    relayServerName: process.env.SB_RP2_RELAY_SERVER_NAME ?? 'localhost',
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
    relayId: peer.relay_id,
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
 *
 * Re-home asks are coalesced (see `rehomeInFlight`) but their answers are deliberately never
 * cached: the coordinator's recorded-rehome path re-checks relay liveness in its registry on every
 * ask and serves a repeat ask without spending a rate-limit token, so asking again is idempotent,
 * cheap, and — crucially — always liveness-checked. A cached `newTarget` would go stale the moment
 * that replacement relay itself dies (a chained relay death): every later survivor would be handed
 * the now-dead replacement forever, with no coordinator call and no liveness check, livelocking the
 * client (dial fails -> escalate -> same dead answer). Coalescing alone collapses the simultaneous
 * burst a single relay death produces, which is the only case the rate limiter cares about.
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

  /**
   * Coalesces concurrent re-home asks for the same `(session, deadRelayId)`. Every game client
   * independently POSTs `netcodeV2Rehome` when its shared home relay dies, so a single relay death
   * fans in as N near-simultaneous asks for one session. Without coalescing they become N coordinator
   * round trips against a per-`(tenant, session)` rate-limit bucket, so a large game's tail survivors
   * get 429'd and dropped despite a healthy replacement. The first ask per key runs the coordinator
   * call; the rest await its in-flight promise. Cleared when that promise settles.
   */
  private rehomeInFlight = new Map<string, Promise<NetcodeV2RehomeResponse>>()

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
    slots: Array<{
      slot: number
      userId: SbUserId
      observer: boolean
      /**
       * The player's chosen home region, forwarded to the coordinator to place this slot's relay.
       * Omitted from the request when absent; the coordinator then places the slot region-blind.
       */
      region?: GameServerRegionId
      /**
       * The player's measured round-trip time (ms) to `region`, if recorded. Combined with every
       * other slot's region/rtt into the session's `latency_estimate_ms` hint; never forwarded to
       * the coordinator per-slot.
       */
      rttMs?: number
    }>
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

      // A fallback for the relay's own initial buffer computation, covering conditions the
      // pre-start window can't observe itself (e.g. a multi-relay session, where pre-start traffic
      // never crosses the mesh). Rounded up so the estimate never under-covers a fractional ms.
      const latencyEstimateMs = worstPairwiseLatencyMs(
        slots.map(({ region, rttMs }) => ({ region, rttMs })),
      )
      const latencyEstimateField =
        latencyEstimateMs !== undefined
          ? // eslint-disable-next-line camelcase
            { latency_estimate_ms: Math.ceil(latencyEstimateMs) }
          : {}

      const request: CoordinatorSessionRequest = {
        tenant: config.tenant,
        // eslint-disable-next-line camelcase
        external_id: gameId,
        players: slots.map(({ slot, userId, observer, region }) => ({
          slot,
          // eslint-disable-next-line camelcase
          client_pubkey: Array.from(Buffer.from(pubkeys.get(userId)!, 'base64')),
          // eslint-disable-next-line camelcase
          external_ref: String(userId),
          observer,
          ...(region !== undefined ? { region } : {}),
        })),
        ...latencyEstimateField,
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

      // Records the session's serving relay(s) at create — the home relay, plus any slot-home
      // override relays (a cross-region session homes slots on different relays) — for the admin
      // debug view's relay-serving history. Deduped by relay id since several slots' overrides can
      // name the same relay. Non-fatal for the same reason as the session id write above.
      try {
        const homeEvents = new Map<number, NetcodeV2RelayEvent>()
        const at = Date.now()
        homeEvents.set(session.home_relay.relay_id, {
          kind: 'home',
          relayId: session.home_relay.relay_id,
          relayAddr: session.home_relay.relay_addr,
          at,
        })
        for (const { relay } of session.slot_homes ?? []) {
          if (!homeEvents.has(relay.relay_id)) {
            homeEvents.set(relay.relay_id, {
              kind: 'home',
              relayId: relay.relay_id,
              relayAddr: relay.relay_addr,
              at,
            })
          }
        }
        await addNetcodeV2RelayEvents(gameId, Array.from(homeEvents.values()))
      } catch (err) {
        log.warn({ err, gameId }, `failed to persist netcode v2 relay history for game ${gameId}`)
      }

      const homeRelay = relayEndpointToInfo(session.home_relay, config)
      // Per-slot home overrides: each listed slot homes on its own relay instead of the session's
      // primary home (a cross-region session; the relays mesh). Empty when every slot shares one.
      const slotHomeBySlot = new Map(
        (session.slot_homes ?? []).map(({ slot, relay }) => [
          slot,
          relayEndpointToInfo(relay, config),
        ]),
      )
      if (slotHomeBySlot.size > 0) {
        log.info(
          `netcode v2 cross-relay session for game ${gameId}: slot(s) ` +
            `${[...slotHomeBySlot.keys()].join(', ')} homing off the primary relay`,
        )
      }

      const userBySlot = new Map(slots.map(({ slot, userId }) => [slot, userId]))

      // The full slot roster, shared by every player's setup: who occupies each slot, plus the
      // create-time home relay/region the `/netstat` overlay shows per player. `region` here is
      // what the slot requested, not necessarily where it ended up homed — the coordinator doesn't
      // echo per-slot serving regions back.
      const roster: NetcodeV2RosterEntry[] = slots.map(({ slot, userId, region }) => ({
        slot,
        userId,
        homeRelayId: (slotHomeBySlot.get(slot) ?? homeRelay).relayId,
        ...(region !== undefined ? { homeRegion: region } : {}),
      }))

      const result = new Map<SbUserId, NetcodeV2ServerSetup>()
      for (const { slot, token } of session.tokens) {
        const userId = userBySlot.get(slot)
        if (userId === undefined) {
          throw new NetcodeV2ServiceError(`coordinator returned a token for unknown slot ${slot}`)
        }

        result.set(userId, {
          token: Buffer.from(token).toString('base64'),
          homeRelay: slotHomeBySlot.get(slot) ?? homeRelay,
          roster,
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

  /**
   * Asks the coordinator to re-home an in-flight session off a relay a client reports dead. The
   * coordinator authoritatively decides whether the named relay is actually gone and, if so, moves
   * the whole group to a replacement, returning it. `stay` means the relay is in fact still live
   * (the client's own path is broken, not the relay); `unavailable` means no relay can take the
   * session over yet. A `newTarget` relay is converted through the same `relayEndpointToInfo` used
   * at session create, so the game client receives the standard pinned-cert descriptor shape.
   *
   * This is a tenant-signed control-plane call (like `/session/create`); the game client never
   * talks to the coordinator itself — it reaches this via the SB `netcodeV2Rehome` HTTP endpoint.
   *
   * @param gameId the game the session belongs to, for recording a `newTarget` decision in the
   *   game's relay-serving history. Passed by the caller (which already resolved it to look up the
   *   session) rather than looked up again here.
   */
  async rehomeSession(
    gameId: string,
    session: number,
    deadRelayId: number,
  ): Promise<NetcodeV2RehomeResponse> {
    const key = `${session}:${deadRelayId}`

    const inFlight = this.rehomeInFlight.get(key)
    if (inFlight) {
      return await inFlight
    }

    const promise = this.requestCoordinatorRehome(gameId, session, deadRelayId)
    this.rehomeInFlight.set(key, promise)
    try {
      return await promise
    } finally {
      this.rehomeInFlight.delete(key)
    }
  }

  private async requestCoordinatorRehome(
    gameId: string,
    session: number,
    deadRelayId: number,
  ): Promise<NetcodeV2RehomeResponse> {
    const config = this.config
    if (!config) {
      throw new NetcodeV2ServiceError('netcode v2 is not configured')
    }

    const request: CoordinatorRehomeRequest = {
      tenant: config.tenant,
      session,
      // eslint-disable-next-line camelcase
      dead_relay_id: deadRelayId,
    }

    let response: CoordinatorRehomeResponse
    try {
      const url = `${config.coordinatorUrl}/session/rehome`
      const bodyStr = JSON.stringify(request)
      response = await got
        .post(url, {
          body: bodyStr,
          headers: {
            'content-type': 'application/json',
            ...signCoordinatorRequest('POST', coordinatorRequestPath(url), bodyStr),
          },
          timeout: { request: 10000 },
        })
        .json<CoordinatorRehomeResponse>()
    } catch (err) {
      throw new NetcodeV2ServiceError('coordinator session rehome failed', { cause: err })
    }

    switch (response.decision) {
      case 'stay':
        return { decision: 'stay' }
      case 'newTarget': {
        if (!response.relay) {
          throw new NetcodeV2ServiceError('coordinator returned a newTarget rehome without a relay')
        }
        const relay = response.relay

        // Recorded once per coordinator decision (this method is the single-flight path behind
        // `rehomeSession`'s coalescing, so N survivors asking about the same dead relay at once
        // still produce one event) for the admin debug view's relay-serving history. Non-fatal —
        // the rehome itself already succeeded and must reach the caller either way.
        try {
          await addNetcodeV2RelayEvents(gameId, [
            {
              kind: 'rehome',
              deadRelayId,
              newRelayId: relay.relay_id,
              newRelayAddr: relay.relay_addr,
              at: Date.now(),
            },
          ])
        } catch (err) {
          log.warn({ err, gameId }, `failed to persist netcode v2 rehome event for game ${gameId}`)
        }

        return { decision: 'newTarget', relay: relayEndpointToInfo(relay, config) }
      }
      case 'unavailable':
        return { decision: 'unavailable' }
      default:
        // An unrecognized decision is treated as "can't move right now" rather than trusted.
        return { decision: 'unavailable' }
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
