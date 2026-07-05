import got from 'got'
import { X509Certificate } from 'node:crypto'
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
        session = await got
          .post(`${config.coordinatorUrl}/session/create`, {
            json: request,
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
    const response = await got
      .post(`${config.coordinatorUrl}/sessions/alive`, {
        json: { tenant: config.tenant, sessions: chunk },
        timeout: { request: 10000 },
      })
      .json<SessionsAliveResponse>()
    for (const session of response.alive) {
      alive.add(session)
    }
  }

  return alive
}
