import { SbUserId } from '../users/sb-user-id'

/**
 * One relay endpoint a game client can dial, plus the TLS material to trust it. Relays use direct
 * IPs (no public CA), so the relay's leaf certificate is pinned: the server hands it to the app
 * alongside the session token, and the app forwards it to the game process.
 *
 * Field names match the game process's `NetcodeV2Relay` (game/src/app_messages.rs).
 */
export interface NetcodeV2RelayInfo {
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
}

/**
 * The server-provided part of a netcode v2 session handoff for one player: their signed session
 * token, the relay(s) to dial, and the full slot roster. The Electron app combines this with the
 * per-session private key it generated locally (which never leaves the user's machine) to build
 * the complete setup message for the game process.
 */
export interface NetcodeV2ServerSetup {
  /** base64 (standard, padded) of this player's coordinator-signed session token. */
  token: string
  homeRelay: NetcodeV2RelayInfo
  backupRelay?: NetcodeV2RelayInfo
  roster: NetcodeV2RosterEntry[]
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
 * Request body for submitting the client's per-session public key to the server during game
 * loading, so the server can request a session token embedding it.
 */
export interface SubmitNetcodeV2PubkeyRequest {
  /** base64 (standard, padded) of the raw 32-byte Ed25519 public key. */
  pubkey: string
}

/**
 * How a player's rally-point2 slot departed a game: a graceful quit vs. an unclean drop
 * (disconnect/crash/force-quit).
 */
export type DepartureKind = 'left' | 'dropped'

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
 * The rally-point2 coordinator's mid-game notification webhook body — a departure, desync, or
 * result event, discriminated by `event`. POSTed to `POST /webhooks/netcode-v2/game-events`.
 */
export type NetcodeV2GameEvent =
  | NetcodeV2DepartureNotification
  | NetcodeV2DesyncNotification
  | NetcodeV2ResultNotification
