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

interface KeyState {
  /** Wall-clock time (`Date.now()`) of the last report actually sent for this key. */
  lastSentAt: number
  /**
   * The newest time value sent (or, while a trailing send is pending, scheduled to be sent) for
   * this key. Reports at or before this value never advance the read position, so they're dropped.
   */
  lastValue: number
  /** A trailing send already scheduled for this key, waiting for the coalescing window to elapse. */
  pending?: {
    send: (time: number) => void
    timer: ReturnType<typeof setTimeout>
  }
}

const keyStates = new Map<string, KeyState>()

/**
 * Reports that `key`'s read position has advanced to `time`, coalescing rapid-fire reports down to
 * at most one outgoing send per `LAST_READ_COALESCE_MS` window. `send` is called with the position
 * to report once this call's report actually goes out (immediately, or later as part of a trailing
 * send); it's expected to be a fire-and-forget request, since nothing here awaits it.
 */
export function reportLastRead(key: string, time: number, send: (time: number) => void): void {
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
    keyStates.set(key, { lastSentAt: Date.now(), lastValue: time })
    send(time)
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
      sendPending(s.lastValue)
    }, LAST_READ_COALESCE_MS - elapsedSinceSend),
  }
}

/**
 * Immediately fires a trailing send scheduled for `key` by `reportLastRead`, if one is pending, and
 * cancels its timer. Meant to be called when a conversation is torn down (e.g. on unmount), so a
 * read position that arrived just before that doesn't sit unreported until the window elapses on
 * its own.
 */
export function flushLastRead(key: string): void {
  const state = keyStates.get(key)
  if (!state?.pending) {
    return
  }

  clearTimeout(state.pending.timer)
  const { send } = state.pending
  state.pending = undefined
  state.lastSentAt = Date.now()
  send(state.lastValue)
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
