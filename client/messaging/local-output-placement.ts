import { SbMessage } from './message-records'

/**
 * Works out what time to stamp a line produced right now with, so it sits at the end of what the
 * user is looking at.
 *
 * Message times come from the server while this runs on a local clock, so the two can't be compared
 * with any confidence. Taking the newest loaded message's time puts the line after everything on
 * screen, whatever the clocks say. Every loaded message counts, including the client-only banners
 * (kicks, bans, leaves) stamped with the local clock: a banner is the last thing on screen as often
 * as a server message is, and a line stamped from an older server message would sort above it. A
 * window detached from the present is showing history, where the end of the window isn't the end of
 * the conversation, so the line takes the later of the two times and lands near the present once the
 * user is back there.
 */
export function getLocalLineTime(
  messages: ReadonlyArray<SbMessage>,
  hasNewerMessages: boolean | undefined,
): number {
  if (messages.length === 0) {
    return Date.now()
  }

  // Local-clock banners sitting among server times mean the list isn't strictly time-ordered, so
  // the latest time anywhere in it is what puts the line after everything loaded.
  let newestTime = messages[0].time
  for (const message of messages) {
    if (message.time > newestTime) {
      newestTime = message.time
    }
  }

  return hasNewerMessages ? Math.max(newestTime, Date.now()) : newestTime
}
