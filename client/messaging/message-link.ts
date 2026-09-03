/**
 * Name of the query param that points a channel or whisper URL at one particular message in the
 * conversation. Reading and writing it must go through this name so a link and the page that
 * consumes it can't disagree.
 */
export const MESSAGE_LINK_PARAM = 'm'

/** Matches a UUID's `8-4-4-4-12` hex layout, case-insensitively. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Returns whether `value` has the shape of a message id: messages are named by UUID. */
export function isMessageLinkId(value: string): boolean {
  return UUID_PATTERN.test(value)
}
