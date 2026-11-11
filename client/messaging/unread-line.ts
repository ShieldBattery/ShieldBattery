/**
 * The unread divider a conversation shows for the visit it's on: the read position it was frozen
 * at, plus what the view has done with it since. The divider renders above the first server-origin
 * message newer than `time`, marking where the user left off, and holds still there rather than
 * chasing the read position as that advances underneath it.
 *
 * It's dropped once it has done its job, which takes the user having had it in view, having been
 * away from the bottom, being back at the bottom, and the read position having moved past it (see
 * `isUnreadLineSpent`). Requiring a trip away from the bottom is what keeps a conversation opened
 * at the bottom with the divider on screen from losing it to the read report that immediately
 * follows; going away and coming back is the user telling the view they're done with it.
 */
export interface UnreadLine {
  /**
   * The read position (epoch ms) the divider was frozen at. It renders above the first
   * server-origin message newer than this.
   */
  time: number
  /** Whether the divider has been inside the viewport at some point since it was placed. */
  seen: boolean
  /** Whether the view has been away from the bottom at some point since the divider was placed. */
  leftBottom: boolean
  /**
   * Whether the divider was in the viewport while the view sat at the present bottom. That is the
   * user having caught up to the present with the divider on screen, as opposed to jumping or
   * scrolling up to it from a view that opened at the bottom and reading down from there.
   */
  caughtUp: boolean
}

/**
 * Freezes a divider at `time` for a view that is or isn't at the bottom right now. A view placing
 * one from anywhere but the bottom has already been away from it, so that counts toward the trip
 * away the divider needs before it can be consumed.
 */
export function placeUnreadLine(time: number, atBottom: boolean): UnreadLine {
  return { time, seen: false, leftBottom: !atBottom, caughtUp: false }
}

/**
 * Returns whether a live message that went unseen starts a new run of unread messages at
 * `lastReadTime`, re-placing the divider there: where there is no divider yet, and where the user
 * caught up past the one that is there and then looked away or scrolled up. A divider the user has
 * not caught up past marks a run they are still reading through, even when a read report on
 * opening the conversation moved the read position beyond it, so it stays where it is.
 */
export function shouldReplaceUnreadLine(
  line: UnreadLine | undefined,
  lastReadTime: number | undefined,
): boolean {
  return (
    lastReadTime !== undefined &&
    (line === undefined || (line.caughtUp && lastReadTime > line.time))
  )
}

/**
 * Returns whether the divider has done its job: the user has looked at where they left off, been
 * away from the bottom, and is now back at the bottom with the read position past the divider.
 */
export function isUnreadLineSpent(
  line: UnreadLine,
  atBottom: boolean,
  lastReadTime: number | undefined,
): boolean {
  return (
    line.seen &&
    line.leftBottom &&
    atBottom &&
    lastReadTime !== undefined &&
    lastReadTime > line.time
  )
}
