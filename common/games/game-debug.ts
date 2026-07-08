import { SbUserId } from '../users/sb-user-id'

/**
 * Debug-only introspection into the state of a running game process. This surface only exists in
 * debug game builds (compiled out of release builds via `#[cfg(debug_assertions)]`) and is only
 * wired up on the app side in dev app sessions (`isDev`). A query sent to a build that doesn't
 * support it never gets a reply, so callers must expect it to time out.
 */

/** One session-roster slot's network turn state, as tracked by the game process. */
export interface GameTurnSlotSnapshot {
  /** The rally-point2 slot number. */
  slot: number
  userId: SbUserId
  /** The BW storm id this slot has been mapped to, or null if it hasn't joined yet. */
  stormId: number | null
  /** Whether this slot gates step readiness (false after a synced leave). */
  required: boolean
  /** Depth of the inbound turn FIFO for this slot. */
  queuedTurns: number
  /** Whether a turn from this slot is present in the current dispatch buffers. */
  hasDispatch: boolean
}

/** One chat line the game process has rendered, recorded at injection time. */
export interface GameChatLogEntry {
  /** The player id the message was attributed to (0-7). */
  senderGameId: number
  /** The message text as injected (already truncated to the classic chat record's capacity). */
  text: string
  /** Whether this client authored the message, as opposed to receiving it from a peer. */
  own: boolean
}

/**
 * This client's own connection state within a {@link GameDisconnectView}. Driven only by the real
 * self-link signal, never by a guess from the remote roster's behavior: an unconfirmed stall (even
 * one covering every remaining remote participant, as in a 1v1 the instant the lone opponent drops)
 * is exactly as likely to be their link as ours, so it is never asserted as a self-connection
 * problem — it shows as a per-peer 'stall' row instead.
 */
export type GameDisconnectSelfState =
  /** Our link is fine; any rows are about peers. */
  | 'ok'
  /** The relay confirmed our own link is down (or the session ended); the driver auto-reconnects. */
  | 'reconnecting'

/** Which disconnect tier a {@link GameDisconnectRow} is in. */
export type GameDisconnectTier =
  /** The sim is blocked on this player, but the relay hasn't confirmed a link death — no drop. */
  | 'stall'
  /** The relay confirmed this player's link is down; the drop unlocks past the threshold. */
  | 'confirmed'

/** One row of the in-game disconnect overlay, as the game process derives it. */
export interface GameDisconnectRow {
  /** The rally-point2 slot this row is about; the target of a manual drop. */
  slot: number
  userId: SbUserId
  tier: GameDisconnectTier
  /** How long the condition has run, in whole seconds (confirmed-disconnect wait, or sustained stall). */
  elapsedSeconds: number
  /** Whether the manual drop is available (a confirmed row past the unlock threshold, ~45s). */
  dropUnlocked: boolean
  /** Whether a drop was requested for this slot within the recent acknowledgement window. */
  dropRequested: boolean
}

/** What the survivor disconnect overlay is showing, as tracked by the game process. */
export interface GameDisconnectView {
  selfState: GameDisconnectSelfState
  /** One entry per blocking or relay-confirmed remote player; empty while `selfState` owns the notice. */
  rows: GameDisconnectRow[]
}

/** A snapshot of a game process's network turn transport state, if a session is live. */
export interface GameTurnStateSnapshot {
  /** The rally-point2 slot of the local player. */
  localSlot: number
  /** The current latency buffer, in turns. */
  latencyTurns: number
  /** The number of local turns currently in flight. */
  outstandingTurns: number
  /** One entry per session-roster slot. */
  slots: GameTurnSlotSnapshot[]
  /**
   * The last chat lines this client has rendered, oldest first. Optional so a still-running older
   * DLL that predates this field doesn't fail to deserialize.
   */
  chatLog?: GameChatLogEntry[]
  /**
   * What the disconnect overlay is showing. Optional so a still-running older DLL that predates this
   * field doesn't fail to deserialize.
   */
  disconnect?: GameDisconnectView
}

/** The reply payload for a `debugControl`/`queryState` request, sent as `/game/debug/state`. */
export interface GameDebugState {
  /** `null` if there is no live session to report on. */
  turnState: GameTurnStateSnapshot | null
}

/** The reply payload for a `debugControl`/`screenshot` request, sent as `/game/debug/screenshot`. */
export interface GameDebugScreenshotReply {
  /** `null` if capture failed; `error` then says why. */
  screenshot: { width: number; height: number; pngBase64: string } | null
  error: string | null
}

/** The result of a debug screenshot request: the captured frame written to a PNG on disk. */
export interface GameDebugScreenshot {
  path: string
  width: number
  height: number
}
