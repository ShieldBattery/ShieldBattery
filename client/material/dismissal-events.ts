const handledDismissals = new WeakMap<MouseEvent, boolean>()

/**
 * Returns whether a particular click event was handled as a dismissal event for an overlay (like a
 * Popover or a Dialog). This is meant to allow particular overlay elements (especially Dialogs)
 * that can themselves contain other overlay elements to ignore dismissals that their children
 * already dealt with.
 */
export function isHandledDismissalEvent(event: MouseEvent) {
  return handledDismissals.has(event)
}

/**
 * Marks an event as having been handled as a dismissal event by an overlay (such as a Popover).
 */
export function markEventAsHandledDismissal(event: MouseEvent) {
  handledDismissals.set(event, true)
}
