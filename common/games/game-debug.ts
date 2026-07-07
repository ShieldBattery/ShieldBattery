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
