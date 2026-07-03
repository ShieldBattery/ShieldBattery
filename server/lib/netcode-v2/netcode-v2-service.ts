import got from 'got'
import { X509Certificate } from 'node:crypto'
import fs from 'node:fs'
import { isIP } from 'node:net'
import { singleton } from 'tsyringe'
import { raceAbort } from '../../../common/async/abort-signals'
import createDeferred, { Deferred } from '../../../common/async/deferred'
import { NetcodeV2RelayInfo, NetcodeV2ServerSetup } from '../../../common/games/netcode-v2'
import { SbUserId } from '../../../common/users/sb-user-id'
import log from '../logging/logger'

/**
 * How many pubkeys we'll hold for a single loading game before ignoring further submissions. A
 * safety net on memory only — the API layer restricts submissions to game participants.
 */
const MAX_PUBKEYS_PER_GAME = 16

export class NetcodeV2ServiceError extends Error {}

/**
 * The wire shapes of the rally-point2 coordinator's `POST /session/create` API. These use the
 * coordinator's serde defaults: snake_case field names, and byte fields (pubkeys, tokens) encoded
 * as JSON arrays of numbers.
 */
interface CoordinatorSessionRequest {
  tenant: string
  players: Array<{ slot: number; client_pubkey: number[] }>
}

interface CoordinatorRelayPeer {
  relay_id: number
  /** The relay's public address as `ip:port` (IPv6 addresses are bracketed). */
  relay_addr: string
}

interface CoordinatorSessionResponse {
  session: number
  home_relay: CoordinatorRelayPeer
  backup_relay: CoordinatorRelayPeer
  tokens: Array<{ slot: number; token: number[] }>
  bounds: { min: number; max: number }
}

interface NetcodeV2Config {
  coordinatorUrl: string
  tenant: string
  /**
   * base64 (standard, padded) DER of the relay leaf certificate clients should pin.
   *
   * NOTE(netcode-v2): this is a dev-loopback interim. The coordinator's session response carries
   * only each relay's address today, not its TLS certificate, so the cert is server config shared
   * by every relay (fine for a loopback where there's one relay with a known cert). Once the
   * coordinator conveys per-relay certs in the session response, this moves there.
   */
  relayCert: string
  /** TLS server name clients validate the relay certificate against. */
  relayServerName: string
}

function loadConfigFromEnv(): NetcodeV2Config | undefined {
  const coordinatorUrl = process.env.SB_RP2_COORDINATOR_URL
  if (!coordinatorUrl) {
    return undefined
  }

  const tenant = process.env.SB_RP2_TENANT
  const relayCertPath = process.env.SB_RP2_RELAY_CERT
  if (!tenant || !relayCertPath) {
    throw new Error(
      'SB_RP2_COORDINATOR_URL is set but SB_RP2_TENANT or SB_RP2_RELAY_CERT is missing',
    )
  }

  // Parsing through X509Certificate validates the cert at startup, rather than letting a corrupt
  // file surface later as TLS pin failures inside every game client
  const relayCert = new X509Certificate(fs.readFileSync(relayCertPath))

  return {
    coordinatorUrl,
    tenant,
    relayCert: relayCert.raw.toString('base64'),
    relayServerName: process.env.SB_RP2_RELAY_SERVER_NAME ?? 'localhost',
  }
}

/**
 * Parses a Rust `SocketAddr` display string (`ip:port`, with IPv6 addresses bracketed) into the
 * relay endpoint shape clients dial.
 */
function relayPeerToInfo(peer: CoordinatorRelayPeer, config: NetcodeV2Config): NetcodeV2RelayInfo {
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

  return {
    address4: family === 4 ? host : undefined,
    address6: family === 6 ? host : undefined,
    port,
    serverName: config.relayServerName,
    cert: config.relayCert,
  }
}

/**
 * Server-side control plane for netcode v2 (rally-point2): collects each player's per-session
 * public key during game loading, requests a session from the coordinator, and produces the
 * per-player handoff (token + relays + roster) the game loader publishes to clients.
 *
 * Enabled by setting `SB_RP2_COORDINATOR_URL` (plus `SB_RP2_TENANT` and `SB_RP2_RELAY_CERT`, a
 * path to the relay's leaf certificate PEM). When disabled, games load exactly as before.
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
    slots: Array<{ slot: number; userId: SbUserId }>
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

      const request: CoordinatorSessionRequest = {
        tenant: config.tenant,
        players: slots.map(({ slot, userId }) => ({
          slot,
          // eslint-disable-next-line camelcase
          client_pubkey: Array.from(Buffer.from(pubkeys.get(userId)!, 'base64')),
        })),
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

      const homeRelay = relayPeerToInfo(session.home_relay, config)
      // A backup equal to the home relay means only one relay was available; skip it in that case.
      const backupRelay =
        session.backup_relay.relay_id !== session.home_relay.relay_id
          ? relayPeerToInfo(session.backup_relay, config)
          : undefined

      const userBySlot = new Map(slots.map(({ slot, userId }) => [slot, userId]))
      const result = new Map<SbUserId, NetcodeV2ServerSetup>()
      for (const { slot, token } of session.tokens) {
        const userId = userBySlot.get(slot)
        if (userId === undefined) {
          throw new NetcodeV2ServiceError(`coordinator returned a token for unknown slot ${slot}`)
        }
        result.set(userId, {
          token: Buffer.from(token).toString('base64'),
          homeRelay,
          backupRelay,
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
