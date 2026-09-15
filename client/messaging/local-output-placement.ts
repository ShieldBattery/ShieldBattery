import { isServerOriginMessage, LocalMessage, SbMessage } from './message-records'

/**
 * Works out where among the loaded messages a line produced right now belongs.
 *
 * Message times come from the server while this runs on a local clock, so the two can't be compared
 * with any confidence. Taking the newest loaded message's time puts the line at the end of what the
 * user is looking at, whatever the clocks say. Every loaded message counts, including the
 * client-only banners (kicks, bans, leaves) stamped with the local clock: a banner is the last thing
 * on screen as often as a server message is, and a line stamped from an older server message would
 * sort above it. A window detached from the present is showing history, where the end of the window
 * isn't the end of the conversation, so the line takes the later of the two times and lands near
 * the present once the user is back there.
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

/**
 * Places session-only messages among the conversation's messages, in time order. A message wins a
 * tie, so a line stamped with the newest message's time sits after it. A line older than the oldest
 * loaded message belongs above the loaded window, where there's nothing for it to sit next to, so
 * it's left out until the window it belongs in is on screen again.
 */
export function mergeLocalLines(
  messages: ReadonlyArray<SbMessage>,
  lines: ReadonlyArray<LocalMessage>,
): ReadonlyArray<SbMessage> {
  if (lines.length === 0) {
    return messages
  }

  const oldestServerTime = messages.find(isServerOriginMessage)?.time
  const placeable = lines
    .filter(line => oldestServerTime === undefined || line.time >= oldestServerTime)
    .sort((a, b) => a.time - b.time)
  if (placeable.length === 0) {
    return messages
  }

  const merged: SbMessage[] = []
  let lineIndex = 0
  for (const message of messages) {
    while (lineIndex < placeable.length && placeable[lineIndex].time < message.time) {
      merged.push(placeable[lineIndex])
      lineIndex += 1
    }
    merged.push(message)
  }
  while (lineIndex < placeable.length) {
    merged.push(placeable[lineIndex])
    lineIndex += 1
  }

  return merged
}
