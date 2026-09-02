/**
 * How long to wait, per conversation, before allowing another read-position report to reach the
 * server. The first report for a conversation (or one that arrives after this much time has passed
 * since the last one actually sent) goes out immediately — the leading edge, so the common case of
 * reading a message and not reading another for a while incurs no added latency. Reports that keep
 * arriving faster than this get folded into a single trailing send of the newest position once the
 * window elapses, so scrolling through a burst of newly-arrived messages sends at most one request
 * per window rather than one per message.
 */
export const LAST_READ_COALESCE_MS = 5000

/**
 * Sends a read position for a conversation. A returned promise that rejects means the position
 * never reached the server, which rolls the coalescing state back so the next report sends again
 * rather than being dropped as already-reported. A sender that returns nothing is taken at its word
 * that the position was reported.
 */
export type LastReadSender = (time: number) => Promise<unknown> | void

interface KeyState {
  /** Wall-clock time (`Date.now()`) of the last report actually sent for this key. */
  lastSentAt: number
  /**
   * The newest time value sent (or, while a trailing send is pending, scheduled to be sent) for
   * this key. Reports at or before this value never advance the read position, so they're dropped.
   */
  lastValue: number
  /**
   * The newest time value a send actually reported to the server, or `-Infinity` when none has. A
   * failed send falls back to this, so the position it couldn't deliver stops counting as reported
   * and the next report carries it out again.
   */
  confirmedValue: number
  /** A trailing send already scheduled for this key, waiting for the coalescing window to elapse. */
  pending?: {
    send: LastReadSender
    timer: ReturnType<typeof setTimeout>
  }
}

const keyStates = new Map<string, KeyState>()

/** Records that `value` reached the server for `key`, so a later failure can fall back to it. */
function confirmSend(key: string, value: number) {
  const state = keyStates.get(key)
  if (state && value > state.confirmedValue) {
    state.confirmedValue = value
  }
}

/**
 * Undoes the bookkeeping of a send of `value` for `key` that never reached the server, so the next
 * report of a position past what the server has isn't dropped as already-reported. A key whose
 * newest value is no longer the failed one has since been taken over by a newer report — either one
 * scheduled to go out or one already sent, both carrying a position past the failed one — and
 * rolling back would throw that newer position away.
 */
function rollbackSend(key: string, value: number) {
  const state = keyStates.get(key)
  if (!state || state.pending || state.lastValue !== value) {
    return
  }

  state.lastValue = state.confirmedValue
}

/** Runs `send` for `key` and records whether the position it carried reached the server. */
function performSend(key: string, send: LastReadSender, value: number) {
  const result = send(value)
  if (!result) {
    confirmSend(key, value)
    return
  }

  result.then(
    () => confirmSend(key, value),
    () => rollbackSend(key, value),
  )
}

/**
 * Reports that `key`'s read position has advanced to `time`, coalescing rapid-fire reports down to
 * at most one outgoing send per `LAST_READ_COALESCE_MS` window. `send` is called with the position
 * to report once this call's report actually goes out (immediately, or later as part of a trailing
 * send); a promise it returns is only used to tell a delivered position from one that has to be
 * reported again, never awaited by the caller.
 */
export function reportLastRead(key: string, time: number, send: LastReadSender): void {
  const state = keyStates.get(key)

  if (state && time <= state.lastValue) {
    return
  }

  if (state?.pending) {
    state.lastValue = time
    return
  }

  const elapsedSinceSend = state ? Date.now() - state.lastSentAt : Infinity
  if (elapsedSinceSend >= LAST_READ_COALESCE_MS) {
    keyStates.set(key, {
      lastSentAt: Date.now(),
      lastValue: time,
      confirmedValue: state?.confirmedValue ?? -Infinity,
    })
    performSend(key, send, time)
    return
  }

  state!.lastValue = time
  state!.pending = {
    send,
    timer: setTimeout(() => {
      const s = keyStates.get(key)
      if (!s?.pending) {
        return
      }

      const { send: sendPending } = s.pending
      s.pending = undefined
      s.lastSentAt = Date.now()
      performSend(key, sendPending, s.lastValue)
    }, LAST_READ_COALESCE_MS - elapsedSinceSend),
  }
}

/**
 * Immediately fires a trailing send scheduled for `key` by `reportLastRead`, if one is pending, and
 * cancels its timer. Meant to be called when a conversation is torn down (e.g. on unmount), so a
 * read position that arrived just before that doesn't sit unreported until the window elapses on
 * its own.
 *
 * A key with nothing scheduled is forgotten here: its coalescing window only means something while
 * the conversation is on screen, and dropping it is what keeps this from holding an entry for every
 * conversation ever opened in a session.
 */
export function flushLastRead(key: string): void {
  const state = keyStates.get(key)
  if (!state) {
    return
  }

  const pending = state.pending
  if (!pending) {
    keyStates.delete(key)
    return
  }

  clearTimeout(pending.timer)
  state.pending = undefined
  state.lastSentAt = Date.now()
  performSend(key, pending.send, state.lastValue)
}

/** Clears all coalescing state across every key, cancelling any pending timers. Only for use in tests. */
export function resetLastReadForTesting(): void {
  for (const state of keyStates.values()) {
    if (state.pending) {
      clearTimeout(state.pending.timer)
    }
  }
  keyStates.clear()
}
