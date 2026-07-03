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
