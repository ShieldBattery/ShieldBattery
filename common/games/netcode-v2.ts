import { GameServerRegionId } from '../game-server-regions'
import { SbUserId } from '../users/sb-user-id'

/**
 * One relay endpoint a game client can dial, plus the TLS material to trust it. Relays use direct
 * IPs (no public CA), so the relay's leaf certificate is pinned: the server hands it to the app
 * alongside the session token, and the app forwards it to the game process.
 *
 * Field names match the game process's `NetcodeV2Relay` (game/src/app_messages.rs).
 */
export interface NetcodeV2RelayInfo {
  /**
   * The coordinator's numeric id for this relay. Carried through so the game process can name the
   * relay it believes dead when it asks the coordinator to re-home a session off it.
   */
  relayId: number
  address4?: string
  address6?: string
  port: number
  /** TLS server name checked against the certificate the relay presents. */
  serverName: string
  /** base64 (standard, padded) of the relay's leaf certificate in DER form. */
  cert: string
}

/**
 * One entry of a session's slot roster: which user occupies a rally-point2 slot. The full roster
 * lets the game process map every player's slot to the network id they're assigned during join.
 */
export interface NetcodeV2RosterEntry {
  slot: number
  userId: SbUserId
  /**
   * The rally-point2 relay this slot was homed on at session create: either its `slot_homes`
   * override, or the session's `home_relay` for every slot without one. A peer's later re-home
   * isn't reflected here — re-homing is per-client-group and not observable by other clients — so
   * this is create-time truth, not live state.
   */
  homeRelayId: number
  /**
   * The game-server region this slot requested at session create, if any. The coordinator doesn't
   * echo back which region a slot actually ended up served from, so a slot whose requested region
   * had no live relay still reports that requested region here even though `homeRelayId` points
   * elsewhere.
   */
  homeRegion?: GameServerRegionId
}

/**
 * The server-provided part of a netcode v2 session handoff for one player: their signed session
 * token, the relay to dial, and the full slot roster. The Electron app combines this with the
 * per-session private key it generated locally (which never leaves the user's machine) to build
 * the complete setup message for the game process.
 */
export interface NetcodeV2ServerSetup {
  /** base64 (standard, padded) of this player's coordinator-signed session token. */
  token: string
  homeRelay: NetcodeV2RelayInfo
  roster: NetcodeV2RosterEntry[]
  /**
   * The turn pipe depth to start the session at. The relay's buffer law starts every session at
   * its tenant's configured minimum and only broadcasts a `BufferDirective` when that computed
   * depth changes, so a client that seeds its own hardcoded default instead of this value can sit
   * one turn ahead of the relay indefinitely if the session never needs to grow past the minimum.
   * Seeding from this value keeps the two in agreement from the first turn.
   */
  initialBufferTurns: number
}

/**
 * The complete netcode v2 launch handoff the Electron app sends to the game process: the server
 * setup plus the locally-generated per-session private key.
 *
 * Field names match the game process's `NetcodeV2Setup` (game/src/app_messages.rs).
 */
export interface NetcodeV2Setup extends NetcodeV2ServerSetup {
  /** base64 (standard, padded) of the PKCS#8 v2 Ed25519 private key for this session. */
  clientPrivateKey: string
}

/**
 * Request body the game process POSTs to `/api/1/games/:gameId/netcodeV2Rehome` when its home relay
 * looks dead and it needs the server to re-home the session. Authenticated exactly like the results
 * and replay submissions: the caller proves it owns the slot by presenting the per-(game, user)
 * `resultCode` the server minted, so no separate credential is needed.
 */
export interface NetcodeV2RehomeRequest {
  userId: SbUserId
  resultCode: string
  /** The coordinator's numeric id for the relay the client believes is dead (its current home). */
  deadRelayId: number
}

/**
 * The server's answer to a re-home request, relayed from the coordinator. `stay` means the named
 * relay is actually still live (keep retrying it); `unavailable` means no relay can take the session
 * over yet; `newTarget` carries the replacement relay to dial (as the standard `NetcodeV2RelayInfo`
 * descriptor, pinned cert included).
 */
export type NetcodeV2RehomeResponse =
  | { decision: 'stay' }
  | { decision: 'unavailable' }
  | { decision: 'newTarget'; relay: NetcodeV2RelayInfo }

/**
 * One relay-serving-history event appended to `games.netcode_v2_relays`: either the relay(s) that
 * served a session from creation, or a later rehome that moved the group to a replacement.
 * Discriminated by `kind`; new variants can be added without a version bump since each row carries
 * its own shape.
 */
export interface NetcodeV2HomeRelayEvent {
  kind: 'home'
  relayId: number
  relayAddr: string
  /** Unix ms when this event was recorded. */
  at: number
}

export interface NetcodeV2RehomeRelayEvent {
  kind: 'rehome'
  deadRelayId: number
  newRelayId: number
  newRelayAddr: string
  /** Unix ms when this event was recorded. */
  at: number
}

export type NetcodeV2RelayEvent = NetcodeV2HomeRelayEvent | NetcodeV2RehomeRelayEvent

/**
 * How a player's rally-point2 slot departed a game: a graceful quit vs. an unclean drop
 * (disconnect/crash/force-quit).
 */
export type DepartureKind = 'left' | 'dropped'

/**
 * A departed slot's retained result report, embedded directly in its departure notice. The relay
 * keeps whatever result payload it recorded for that slot (if any) and carries it into the
 * departure record, so a departure is atomic terminal truth for its slot: left/dropped, and here
 * is the result -- or there provably never was one. Same payload/arrival/frame shape as
 * `NetcodeV2ResultNotification`'s own fields, and redundant with any earlier standalone `result`
 * event for the same slot (both the fast path at the victory dialog and this embedded copy can
 * deliver the same report), so ingesting it twice is expected and harmless.
 */
export interface NetcodeV2EmbeddedResult {
  /** base64 of the reporting client's serialized result report JSON, opaque to the relay. */
  payload: string
  /** Unix ms when the relay's connection to the reporting client received the report. */
  arrivalMs: number
  /** The relay's local lockstep frame at arrival, if known. */
  sessionFrame?: number
  /** The reporting slot's last stamped frame, if known. */
  slotFrame?: number
}

/**
 * A mid-game player departure webhook body, POSTed by the rally-point2 coordinator to the app
 * server (as one variant of `NetcodeV2GameEvent`) when a relay decides a player's slot has
 * permanently left a session.
 *
 * `externalId`/`externalRef` are the correlation ids the app server attached at session create
 * (the game's `gameId` and the player's `SbUserId`, respectively) and the coordinator echoes back
 * so the notification is self-describing.
 */
export interface NetcodeV2DepartureNotification {
  event: 'departure'
  tenant: string
  session: number
  /** The `gameId` this session was created for, if the coordinator still has it on record. */
  externalId?: string
  slot: number
  /** The departed player's `SbUserId`, stringified, if the coordinator still has it on record. */
  externalRef?: string
  kind: DepartureKind
  /** The raw BW `pending_leave_reason` value the relay mapped `kind` from; carried for debugging. */
  reason: number
  /** The relay's leave ordering/telemetry sequence number for this session. */
  leaveSeq: number
  /** The departed slot's retained result, if the relay ever recorded one for it. */
  result?: NetcodeV2EmbeddedResult
}

/** One slot the relay observed diverging from the majority sync-checksum lineage. */
export interface NetcodeV2DivergedSlot {
  slot: number
  /** The diverged player's `SbUserId`, stringified, if the coordinator still has it on record. */
  externalRef?: string
}

/**
 * A mid-game desync webhook body, POSTed by the rally-point2 coordinator to the app server (as one
 * variant of `NetcodeV2GameEvent`) when the authority relay's sync-checksum comparator sees a
 * slot's `0x37` sync command diverge from the agreeing majority.
 *
 * `diverged` is empty exactly when `noMajority` is true — the relay deliberately doesn't guess
 * "who's wrong" when there's no strict majority to trust (1v1, or an even split).
 */
export interface NetcodeV2DesyncNotification {
  event: 'desync'
  tenant: string
  session: number
  /** The `gameId` this session was created for, if the coordinator still has it on record. */
  externalId?: string
  /** The per-slot sync ordinal (count of `0x37` commands) the comparator disagreed on. */
  syncOrdinal: number
  /** The closest observed `game_frame_count`, for human-meaningful correlation, if known. */
  gameFrame?: number
  /** Unix ms when the relay detected the divergence. */
  detectedAtMs: number
  /** True when no strict majority of compared slots agreed (1v1, or an even split) — undecidable. */
  noMajority: boolean
  /** The diverged minority's slots, empty when `noMajority` is true. */
  diverged: NetcodeV2DivergedSlot[]
}

/**
 * A game result report webhook body, POSTed by the rally-point2 coordinator to the app server (as
 * one variant of `NetcodeV2GameEvent`) when a relay forwards a client's result report. The report
 * itself is the same `GameResultsReport` JSON the game client would otherwise POST to `results2`,
 * carried as opaque base64 bytes — rp2 never parses it, only relays it.
 *
 * `externalId`/`externalRef` are the correlation ids the app server attached at session create
 * (the game's `gameId` and the reporting player's `SbUserId`, respectively) and the coordinator
 * echoes back so the notification is self-describing.
 */
export interface NetcodeV2ResultNotification {
  event: 'result'
  tenant: string
  session: number
  /** The `gameId` this session was created for, if the coordinator still has it on record. */
  externalId?: string
  slot: number
  /** The reporting player's `SbUserId`, stringified, if the coordinator still has it on record. */
  externalRef?: string
  /** base64 of the reporting client's serialized result report JSON, opaque to the relay. */
  payload: string
  /** Unix ms when the relay's connection to the reporting client received the report. */
  arrivalMs: number
  /** The relay's local lockstep frame at arrival, if known. */
  sessionFrame?: number
  /** The reporting slot's last stamped frame, if known. */
  slotFrame?: number
}

/**
 * The rally-point2 coordinator's final notice for a session, POSTed once every relay that served
 * it has torn down its state. Webhook dispatch is serialized per session, so ingesting this event
 * guarantees every other notice for the session was already delivered or permanently exhausted --
 * nothing for it is still in flight. SB force-reconciles the game immediately on ingest, with
 * whatever evidence has landed, which covers a slot whose result and departure notices were both
 * lost.
 */
export interface NetcodeV2SessionClosedNotification {
  event: 'sessionClosed'
  tenant: string
  session: number
  /** The `gameId` this session was created for, if the coordinator still has it on record. */
  externalId?: string
}

/**
 * The rally-point2 coordinator's mid-game notification webhook body — a departure, desync,
 * result, or sessionClosed event, discriminated by `event`. POSTed to
 * `POST /webhooks/netcode-v2/game-events`.
 */
export type NetcodeV2GameEvent =
  | NetcodeV2DepartureNotification
  | NetcodeV2DesyncNotification
  | NetcodeV2ResultNotification
  | NetcodeV2SessionClosedNotification
